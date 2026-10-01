//! Syntax highlighting sidecar for the theme editor.
//!
//! Uses Helix's own highlighter (tree-house) together with the grammars and queries
//! from the Helix runtime directories, so the scopes produced match what Helix shows.
//!
//! Protocol: newline-delimited JSON on stdin/stdout.
//!   -> {"cmd":"init","runtime_dirs":[...],"languages":[{name,grammar,injection_regex,file_types,shebangs}]}
//!   <- {"ok":true}
//!   -> {"cmd":"highlight","language":"rust","text":"..."}
//!   <- {"ok":true,"scopes":["keyword",...],"spans":[[start,end,[scope_idx,...]],...]}
//! Offsets are UTF-16 code units so they index directly into JavaScript strings.

use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Duration;

use regex::Regex;
use ropey::Rope;
use serde::Deserialize;
use serde_json::{json, Value};
use tree_house::highlighter::{Highlight, HighlightEvent, Highlighter};
use tree_house::tree_sitter::Grammar;
use tree_house::{read_query, InjectionLanguageMarker, Language, LanguageConfig, LanguageLoader, Syntax};

#[derive(Deserialize, Clone)]
struct LangInfo {
    name: String,
    #[serde(default)]
    grammar: Option<String>,
    #[serde(default)]
    injection_regex: Option<String>,
    #[serde(default)]
    file_types: Vec<String>,
    #[serde(default)]
    shebangs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Init {
        runtime_dirs: Vec<PathBuf>,
        languages: Vec<LangInfo>,
    },
    Highlight {
        language: String,
        text: String,
    },
}

struct Loader {
    runtime_dirs: Vec<PathBuf>,
    langs: Vec<LangInfo>,
    injection_regexes: Vec<Option<Regex>>,
    by_name: HashMap<String, usize>,
    configs: Vec<OnceCell<Option<LanguageConfig>>>,
    errors: RefCell<HashMap<String, String>>,
    scopes: RefCell<Vec<String>>,
    scope_ids: RefCell<HashMap<String, u32>>,
}

impl Loader {
    fn new(runtime_dirs: Vec<PathBuf>, langs: Vec<LangInfo>) -> Self {
        let injection_regexes = langs
            .iter()
            .map(|l| l.injection_regex.as_deref().and_then(|r| Regex::new(r).ok()))
            .collect();
        let by_name = langs.iter().enumerate().map(|(i, l)| (l.name.clone(), i)).collect();
        let configs = (0..langs.len()).map(|_| OnceCell::new()).collect();
        Loader {
            runtime_dirs,
            langs,
            injection_regexes,
            by_name,
            configs,
            errors: RefCell::default(),
            scopes: RefCell::default(),
            scope_ids: RefCell::default(),
        }
    }

    /// First matching file across runtime dirs, like `helix_loader::runtime_file`.
    fn runtime_file(&self, rel: &str) -> Option<PathBuf> {
        self.runtime_dirs.iter().map(|d| d.join(rel)).find(|p| p.exists())
    }

    fn query_text(&self, lang: &str, file: &str) -> String {
        read_query(lang, |l| {
            self.runtime_file(&format!("queries/{l}/{file}"))
                .and_then(|p| std::fs::read_to_string(p).ok())
                .unwrap_or_default()
        })
    }

    fn scope_id(&self, scope: &str) -> u32 {
        if let Some(&id) = self.scope_ids.borrow().get(scope) {
            return id;
        }
        let mut scopes = self.scopes.borrow_mut();
        let id = scopes.len() as u32;
        scopes.push(scope.to_owned());
        self.scope_ids.borrow_mut().insert(scope.to_owned(), id);
        id
    }

    fn load_config(&self, idx: usize) -> Result<LanguageConfig, String> {
        let info = &self.langs[idx];
        let grammar_name = info.grammar.as_deref().unwrap_or(&info.name);
        let lib = self
            .runtime_file(&format!("grammars/{grammar_name}.so"))
            .ok_or_else(|| format!("grammar '{grammar_name}' not found in runtime dirs (try `hx --grammar build`)"))?;
        let grammar = unsafe { Grammar::new(grammar_name, &lib) }.map_err(|e| format!("failed to load grammar '{grammar_name}': {e}"))?;
        let highlights = self.query_text(&info.name, "highlights.scm");
        let injections = self.query_text(&info.name, "injections.scm");
        let locals = self.query_text(&info.name, "locals.scm");
        let config = LanguageConfig::new(grammar, &highlights, &injections, &locals)
            .map_err(|e| format!("query error for '{}': {e}", info.name))?;
        config.configure(|scope| Some(Highlight::new(self.scope_id(scope))));
        Ok(config)
    }

    fn language_by_file(&self, name: &str) -> Option<Language> {
        let ext = name.rsplit('.').next().unwrap_or(name);
        self.langs
            .iter()
            .position(|l| l.file_types.iter().any(|ft| ft == name || ft == ext))
            .map(|i| Language::new(i as u32))
    }
}

impl LanguageLoader for Loader {
    fn language_for_marker(&self, marker: InjectionLanguageMarker) -> Option<Language> {
        let idx = match marker {
            InjectionLanguageMarker::Name(name) => self.by_name.get(name).copied(),
            InjectionLanguageMarker::Match(text) => {
                let text: String = text.into();
                // Helix picks the language whose injection regex gives the longest match.
                let mut best: Option<(usize, usize)> = None;
                for (i, re) in self.injection_regexes.iter().enumerate() {
                    let Some(m) = re.as_ref().and_then(|re| re.find(&text)) else { continue };
                    if best.map_or(true, |(_, l)| m.len() > l) {
                        best = Some((i, m.len()));
                    }
                }
                best.map(|(i, _)| i)
            }
            InjectionLanguageMarker::Filename(text) => {
                let text: String = text.into();
                return self.language_by_file(text.rsplit('/').next().unwrap_or(&text));
            }
            InjectionLanguageMarker::Shebang(text) => {
                let text: String = text.into();
                self.langs.iter().position(|l| l.shebangs.iter().any(|s| *s == text))
            }
        };
        idx.map(|i| Language::new(i as u32))
    }

    fn get_config(&self, lang: Language) -> Option<&LanguageConfig> {
        let idx = lang.idx();
        self.configs
            .get(idx)?
            .get_or_init(|| match self.load_config(idx) {
                Ok(c) => Some(c),
                Err(e) => {
                    self.errors.borrow_mut().insert(self.langs[idx].name.clone(), e);
                    None
                }
            })
            .as_ref()
    }
}

fn highlight(loader: &Loader, language: &str, text: &str) -> Result<Value, String> {
    let idx = *loader.by_name.get(language).ok_or_else(|| format!("unknown language '{language}'"))?;
    let lang = Language::new(idx as u32);
    if loader.get_config(lang).is_none() {
        let err = loader.errors.borrow().get(language).cloned();
        return Err(err.unwrap_or_else(|| format!("could not load '{language}'")));
    }
    let rope = Rope::from_str(text);
    let src = rope.slice(..);
    let syntax = Syntax::new(src, lang, Duration::from_secs(5), loader).map_err(|e| format!("parse failed: {e:?}"))?;

    // byte offset -> utf16 offset lookup
    let mut utf16 = vec![0u32; text.len() + 1];
    let mut u = 0u32;
    for (b, ch) in text.char_indices() {
        for i in 0..ch.len_utf8() {
            utf16[b + i] = u;
        }
        u += ch.len_utf16() as u32;
    }
    utf16[text.len()] = u;

    let len = text.len() as u32;
    let mut spans: Vec<(u32, u32, Vec<u32>)> = Vec::new();
    let mut hl = Highlighter::new(&syntax, src, loader, 0..);
    let mut stack: Vec<u32> = Vec::new();
    let mut pos = hl.next_event_offset();
    while pos < len {
        let (event, new) = hl.advance();
        if event == HighlightEvent::Refresh {
            stack.clear();
        }
        stack.extend(new.map(|h| h.get()));
        let start = pos;
        pos = hl.next_event_offset();
        if pos == u32::MAX {
            pos = len;
        }
        if pos <= start {
            break;
        }
        if !stack.is_empty() {
            spans.push((utf16[start as usize], utf16[pos.min(len) as usize], stack.clone()));
        }
    }

    let errors: Vec<String> = loader
        .errors
        .borrow()
        .iter()
        .filter(|(k, _)| k.as_str() != language)
        .map(|(_, v)| v.clone())
        .collect();
    Ok(json!({ "ok": true, "scopes": *loader.scopes.borrow(), "spans": spans, "warnings": errors }))
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    let mut loader: Option<Loader> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Err(e) => json!({ "ok": false, "error": format!("bad request: {e}") }),
            Ok(Request::Init { runtime_dirs, languages }) => {
                loader = Some(Loader::new(runtime_dirs, languages));
                json!({ "ok": true })
            }
            Ok(Request::Highlight { language, text }) => match &loader {
                None => json!({ "ok": false, "error": "not initialised" }),
                Some(l) => {
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| highlight(l, &language, &text)));
                    match result {
                        Ok(Ok(v)) => v,
                        Ok(Err(e)) => json!({ "ok": false, "error": e }),
                        Err(_) => json!({ "ok": false, "error": "highlighter panicked" }),
                    }
                }
            },
        };
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}
