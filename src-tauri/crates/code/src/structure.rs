//! Detected Rust code structure over the real AST (`syn`, not
//! regular expressions). A mirror of the TypeScript extractor: same IR,
//! same caps, same resolution rule (global name uniqueness).
//!
//! Supported subset:
//! - Structs (named, tuple and unit) with their fields.
//! - Enums with variants (variants are members, not symbols).
//! - Traits with their declared methods.
//! - `impl` blocks (inherent and `impl Trait for Type`): methods attach
//!   to the type when there is ONE single symbol with that name; `impl`s
//!   of external or ambiguous types are omitted (documented).
//! - `impl Trait for Type` as an `implements` relation.
//! - Field and variant types as `references` (last segment).
//!
//! HTTP APIs (documented subset, same file):
//! - ENDPOINTS (what is exposed): Actix attributes
//!   `#[get|post|…("/route")]` on functions, and Axum
//!   `.route("/route", get(h))` (including chains like
//!   `get(a).post(b)`, which generate one endpoint per method;
//!   intermediate `.layer()` calls are traversed).
//! - CALLS (what is consumed): qualified
//!   `reqwest::get|post|…("<url>")`, and `.verb("<url>")` on an
//!   unknown receiver with an explicit note (unverified reqwest shape).
//! - The URL must be a text literal starting with `/` (endpoints) or
//!   any literal (calls; absolute ones are kept to separate them as
//!   external).
//!
//! NOT supported (documented, not invented):
//! - Macros (including `derive`), modules (`mod`), `use`, constants,
//!   statics, unions, closures, generics (detail ignored), lifetimes
//!   and `extern` blocks.
//! - Composition/aggregation: everything is `references`.
//! - Actix `#[route("…", method = "…")]`, `format!`/URL concatenation,
//!   other HTTP clients.
//! - Honest limit: any `.get("…")` registers by shape with its note;
//!   joining with real endpoints is what gives it meaning.
//! - Error tolerance: `syn` fails the whole file (`error` status),
//!   unlike the TypeScript partial one.

use std::collections::{HashMap, HashSet};

use syn::spanned::Spanned as _;

/// Documented caps (same as in TypeScript).
pub const MAX_STRUCTURE_FILES: usize = 20;
pub const MAX_STRUCTURE_SYMBOLS: usize = 300;
pub const MAX_STRUCTURE_RELATIONS: usize = 500;
pub const MAX_STRUCTURE_MEMBERS: usize = 50;
pub const MAX_STRUCTURE_ENDPOINTS: usize = 200;
pub const MAX_STRUCTURE_CALLS: usize = 200;

/// 32-bit FNV-1a fingerprint over UTF-8 bytes. Identical to the
/// frontend one (`fnv1aHex`): a change detector, not a cryptographic hash.
pub fn fnv1a_hex(content: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in content.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// 1-based range, ready for Monaco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsRange {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsMember {
    /// `field`, `method` or `variant`.
    pub kind: String,
    pub name: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsSymbol {
    pub id: String,
    /// `struct`, `enum` or `trait`.
    pub kind: String,
    pub name: String,
    pub root_id: String,
    pub rel: String,
    pub range: RsRange,
    pub members: Vec<RsMember>,
    pub members_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsRelation {
    pub id: String,
    /// `implements` or `references` (traits do not inherit like classes).
    pub kind: String,
    pub from: String,
    pub to: Option<String>,
    pub to_name: String,
    /// `resolved`, `unresolved` or `ambiguous`.
    pub status: String,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsFile {
    pub root_id: String,
    pub rel: String,
    pub hash: String,
    pub bytes: usize,
    /// `ok` or `error` (`syn` is not error-tolerant).
    pub status: String,
    pub message: Option<String>,
}

/// Detected HTTP API point (exposed route or call). `url` keeps the
/// original literal; the normalization for joining lives in the
/// frontend (`apiLinks.ts`), in one place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsApiPoint {
    pub id: String,
    /// Uppercase verb or `ALL`.
    pub method: String,
    pub url: String,
    pub root_id: String,
    pub rel: String,
    pub range: RsRange,
    pub evidence: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RsStructure {
    pub files: Vec<RsFile>,
    pub symbols: Vec<RsSymbol>,
    pub relations: Vec<RsRelation>,
    pub endpoints: Vec<RsApiPoint>,
    pub calls: Vec<RsApiPoint>,
    pub symbols_truncated: bool,
    pub relations_truncated: bool,
    pub endpoints_truncated: bool,
    pub calls_truncated: bool,
}

struct PendingRef {
    from: String,
    kind: String,
    to_name: String,
    evidence: String,
    ordinal: usize,
}

struct ImplBlock {
    type_name: String,
    trait_name: Option<String>,
    methods: Vec<RsMember>,
    evidence: String,
    ordinal: usize,
}

fn short_text(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        let head: String = flat.chars().take(max - 1).collect();
        format!("{head}…")
    } else {
        flat
    }
}

fn range_of(span: proc_macro2::Span) -> RsRange {
    let start = span.start();
    let end = span.end();
    RsRange {
        start_line: start.line,
        start_col: start.column + 1,
        end_line: end.line,
        end_col: end.column + 1,
    }
}

fn evidence_of(rel: &str, span: proc_macro2::Span, what: &str) -> String {
    format!("{}:{} ({what})", rel, span.start().line)
}

/// Last segment of a type (`Option<Foo>` → `Foo`; `a::B` → `B`).
/// Primitives and empty generics return `None`.
fn type_names(ty: &syn::Type) -> Vec<String> {
    fn visit(ty: &syn::Type, out: &mut Vec<String>) {
        match ty {
            syn::Type::Path(type_path) => {
                if let Some(name) = type_path
                    .path
                    .segments
                    .last()
                    .map(|segment| segment.ident.to_string())
                {
                    if !is_primitive(&name) {
                        out.push(name);
                    }
                }
                // Recurse into generic arguments: `Vec<Foo>`.
                if let Some(segment) = type_path.path.segments.last() {
                    if let syn::PathArguments::AngleBracketed(args) = &segment.arguments {
                        for arg in &args.args {
                            if let syn::GenericArgument::Type(inner) = arg {
                                visit(inner, out);
                            }
                        }
                    }
                }
            }
            syn::Type::Reference(reference) => visit(&reference.elem, out),
            syn::Type::Slice(slice) => visit(&slice.elem, out),
            syn::Type::Array(array) => visit(&array.elem, out),
            syn::Type::Tuple(tuple) => {
                for elem in &tuple.elems {
                    visit(elem, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    visit(ty, &mut out);
    out
}

/// Standard-library primitives and wrappers/containers generating no
/// references (generic content is still traversed).
fn is_primitive(name: &str) -> bool {
    matches!(
        name,
        "bool"
            | "char"
            | "str"
            | "String"
            | "u8"
            | "u16"
            | "u32"
            | "u64"
            | "u128"
            | "usize"
            | "i8"
            | "i16"
            | "i32"
            | "i64"
            | "i128"
            | "isize"
            | "f32"
            | "f64"
            | "Self"
            | "Option"
            | "Result"
            | "Vec"
            | "VecDeque"
            | "LinkedList"
            | "HashMap"
            | "HashSet"
            | "BTreeMap"
            | "BTreeSet"
            | "Box"
            | "Rc"
            | "Arc"
            | "RefCell"
            | "Cell"
            | "Mutex"
            | "RwLock"
            | "OnceLock"
            | "Cow"
            | "Pin"
            | "PhantomData"
    )
}

fn quote_to_string<T: quote::ToTokens>(node: &T) -> String {
    quote::quote!(#node).to_string()
}

fn fn_detail(sig: &syn::Signature) -> String {
    let inputs: Vec<String> = sig
        .inputs
        .iter()
        .map(|arg| match arg {
            syn::FnArg::Receiver(receiver) => {
                if receiver.reference.is_some() {
                    "&self".to_string()
                } else {
                    "self".to_string()
                }
            }
            syn::FnArg::Typed(typed) => short_text(&quote_to_string(&typed.ty), 40),
        })
        .collect();
    let output = match &sig.output {
        syn::ReturnType::Default => String::new(),
        syn::ReturnType::Type(_, ty) => format!(" -> {}", short_text(&quote_to_string(ty), 40)),
    };
    short_text(&format!("({}){output}", inputs.join(", ")), 80)
}

fn push_member(members: &mut Vec<RsMember>, truncated: &mut bool, member: RsMember) {
    if members.len() >= MAX_STRUCTURE_MEMBERS {
        *truncated = true;
        return;
    }
    members.push(member);
}

fn symbol_id(root_id: &str, rel: &str, ordinal: usize) -> String {
    format!("rs:{root_id}:{rel}#{ordinal}")
}

fn api_id(root_id: &str, rel: &str, ordinal: usize) -> String {
    format!("rsapi:{root_id}:{rel}#{ordinal}")
}

fn is_http_verb(name: &str) -> bool {
    matches!(
        name,
        "get" | "post" | "put" | "patch" | "delete" | "head" | "options"
    )
}

/// Actix attribute `#[verb("/path")]`: a single text literal.
fn actix_route(attr: &syn::Attribute) -> Option<(String, String)> {
    let verb = attr.path().segments.last()?.ident.to_string();
    if !is_http_verb(&verb) {
        return None;
    }
    let lit: syn::LitStr = attr.parse_args().ok()?;
    let url = lit.value();
    if !url.starts_with('/') {
        return None;
    }
    Some((verb.to_uppercase(), url))
}

/// Methods of an Axum `MethodRouter`: `get(h)`, `get(a).post(b)`,
/// traversing `.layer()` and other intermediate calls. No duplicates.
fn axum_methods(expr: &syn::Expr) -> Vec<String> {
    let mut methods = Vec::new();
    let mut current = expr;
    loop {
        match current {
            syn::Expr::Call(call) => {
                if let syn::Expr::Path(path) = &*call.func {
                    if let Some(segment) = path.path.segments.last() {
                        let name = segment.ident.to_string();
                        if is_http_verb(&name) {
                            let upper = name.to_uppercase();
                            if !methods.contains(&upper) {
                                methods.push(upper);
                            }
                        }
                    }
                }
                break;
            }
            syn::Expr::MethodCall(method) => {
                let name = method.method.to_string();
                if is_http_verb(&name) {
                    let upper = name.to_uppercase();
                    if !methods.contains(&upper) {
                        methods.push(upper);
                    }
                }
                current = &method.receiver;
            }
            _ => break,
        }
    }
    // The chain walks from outside in: reversing = source order.
    methods.reverse();
    methods
}

fn str_arg(args: &syn::punctuated::Punctuated<syn::Expr, syn::token::Comma>) -> Option<String> {
    match args.first()? {
        syn::Expr::Lit(lit) => match &lit.lit {
            syn::Lit::Str(text) => Some(text.value()),
            _ => None,
        },
        _ => None,
    }
}

struct ApiWalker<'a> {
    root_id: &'a str,
    rel: &'a str,
    ordinal: &'a mut usize,
    endpoints: Vec<RsApiPoint>,
    calls: Vec<RsApiPoint>,
}

impl ApiWalker<'_> {
    fn next(&mut self) -> usize {
        let current = *self.ordinal;
        *self.ordinal += 1;
        current
    }

    fn push_endpoint(&mut self, method: String, url: String, span: proc_macro2::Span, what: &str) {
        let id = api_id(self.root_id, self.rel, self.next());
        self.endpoints.push(RsApiPoint {
            id,
            method,
            url: short_text(&url, 300),
            root_id: self.root_id.to_string(),
            rel: self.rel.to_string(),
            range: range_of(span),
            evidence: evidence_of(self.rel, span, what),
            note: None,
        });
    }

    fn push_call(
        &mut self,
        method: String,
        url: String,
        span: proc_macro2::Span,
        what: &str,
        note: Option<String>,
    ) {
        let id = api_id(self.root_id, self.rel, self.next());
        self.calls.push(RsApiPoint {
            id,
            method,
            url: short_text(&url, 300),
            root_id: self.root_id.to_string(),
            rel: self.rel.to_string(),
            range: range_of(span),
            evidence: evidence_of(self.rel, span, what),
            note,
        });
    }
}

impl<'ast> syn::visit::Visit<'ast> for ApiWalker<'_> {
    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {
        for attr in &node.attrs {
            if let Some((method, url)) = actix_route(attr) {
                let what = format!("actix {}", method.to_lowercase());
                self.push_endpoint(method, url, node.sig.ident.span(), &what);
            }
        }
        syn::visit::visit_item_fn(self, node);
    }

    fn visit_expr_method_call(&mut self, node: &'ast syn::ExprMethodCall) {
        use syn::spanned::Spanned as _;
        // Post-order: in chains (`a().route().route()`) the inner part
        // emits first, which is source order.
        syn::visit::visit_expr_method_call(self, node);
        let name = node.method.to_string();
        if name == "route" {
            if let (Some(url), Some(router)) = (str_arg(&node.args), node.args.iter().nth(1)) {
                if url.starts_with('/') {
                    for method in axum_methods(router) {
                        self.push_endpoint(method, url.clone(), node.span(), "axum route");
                    }
                }
            }
        } else if is_http_verb(&name) {
            if let Some(url) = str_arg(&node.args) {
                self.push_call(
                    name.to_uppercase(),
                    url,
                    node.span(),
                    &format!(".{name}"),
                    Some(
                        "verb(url) shape with an unverified receiver (reqwest or another client)"
                            .to_string(),
                    ),
                );
            }
        }
    }

    fn visit_expr_call(&mut self, node: &'ast syn::ExprCall) {
        use syn::spanned::Spanned as _;
        syn::visit::visit_expr_call(self, node);
        if let syn::Expr::Path(path) = &*node.func {
            let segments: Vec<String> = path
                .path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect();
            if segments.len() == 2 && segments[0] == "reqwest" && is_http_verb(&segments[1]) {
                if let Some(url) = str_arg(&node.args) {
                    self.push_call(
                        segments[1].to_uppercase(),
                        url,
                        node.span(),
                        &format!("reqwest::{}", segments[1]),
                        None,
                    );
                }
            }
        }
    }
}

struct FileOutcome {
    symbols: Vec<RsSymbol>,
    refs: Vec<PendingRef>,
    impls: Vec<ImplBlock>,
    endpoints: Vec<RsApiPoint>,
    calls: Vec<RsApiPoint>,
}

fn analyze_file(
    root_id: &str,
    rel: &str,
    content: &str,
    ordinal: &mut usize,
) -> Result<FileOutcome, String> {
    let file = syn::parse_file(content).map_err(|err| err.to_string())?;
    let mut outcome = FileOutcome {
        symbols: Vec::new(),
        refs: Vec::new(),
        impls: Vec::new(),
        endpoints: Vec::new(),
        calls: Vec::new(),
    };
    {
        use syn::visit::Visit as _;
        let mut walker = ApiWalker {
            root_id,
            rel,
            ordinal: &mut *ordinal,
            endpoints: Vec::new(),
            calls: Vec::new(),
        };
        walker.visit_file(&file);
        outcome.endpoints = walker.endpoints;
        outcome.calls = walker.calls;
    }
    for item in &file.items {
        match item {
            syn::Item::Struct(item_struct) => {
                let mut next = || {
                    let current = *ordinal;
                    *ordinal += 1;
                    current
                };
                let id = symbol_id(root_id, rel, next());
                let mut members = Vec::new();
                let mut truncated = false;
                let mut field_types: Vec<(String, proc_macro2::Span)> = Vec::new();
                match &item_struct.fields {
                    syn::Fields::Named(named) => {
                        for field in &named.named {
                            let name = field
                                .ident
                                .as_ref()
                                .map_or_else(|| "_".to_string(), |ident| ident.to_string());
                            push_member(
                                &mut members,
                                &mut truncated,
                                RsMember {
                                    kind: "field".to_string(),
                                    name,
                                    detail: short_text(&quote_to_string(&field.ty), 80),
                                },
                            );
                            for target in type_names(&field.ty) {
                                field_types.push((target, field.ty.span()));
                            }
                        }
                    }
                    syn::Fields::Unnamed(unnamed) => {
                        for (index, field) in unnamed.unnamed.iter().enumerate() {
                            push_member(
                                &mut members,
                                &mut truncated,
                                RsMember {
                                    kind: "field".to_string(),
                                    name: index.to_string(),
                                    detail: short_text(&quote_to_string(&field.ty), 80),
                                },
                            );
                            for target in type_names(&field.ty) {
                                field_types.push((target, field.ty.span()));
                            }
                        }
                    }
                    syn::Fields::Unit => {}
                }
                outcome.symbols.push(RsSymbol {
                    id: id.clone(),
                    kind: "struct".to_string(),
                    name: item_struct.ident.to_string(),
                    root_id: root_id.to_string(),
                    rel: rel.to_string(),
                    range: range_of(item_struct.ident.span()),
                    members,
                    members_truncated: truncated,
                });
                let mut seen = HashSet::new();
                for (target, span) in field_types {
                    if seen.insert(target.clone()) {
                        outcome.refs.push(PendingRef {
                            from: id.clone(),
                            kind: "references".to_string(),
                            to_name: target,
                            evidence: evidence_of(rel, span, "field"),
                            ordinal: next(),
                        });
                    }
                }
            }
            syn::Item::Enum(item_enum) => {
                let mut next = || {
                    let current = *ordinal;
                    *ordinal += 1;
                    current
                };
                let id = symbol_id(root_id, rel, next());
                let mut members = Vec::new();
                let mut truncated = false;
                let mut field_types: Vec<(String, proc_macro2::Span)> = Vec::new();
                for variant in &item_enum.variants {
                    let detail = match &variant.fields {
                        syn::Fields::Named(named) => {
                            let fields: Vec<String> = named
                                .named
                                .iter()
                                .map(|field| {
                                    for target in type_names(&field.ty) {
                                        field_types.push((target, field.ty.span()));
                                    }
                                    quote_to_string(&field.ty)
                                })
                                .collect();
                            format!("{{ {} }}", short_text(&fields.join(", "), 60))
                        }
                        syn::Fields::Unnamed(unnamed) => {
                            let fields: Vec<String> = unnamed
                                .unnamed
                                .iter()
                                .map(|field| {
                                    for target in type_names(&field.ty) {
                                        field_types.push((target, field.ty.span()));
                                    }
                                    quote_to_string(&field.ty)
                                })
                                .collect();
                            format!("({})", short_text(&fields.join(", "), 60))
                        }
                        syn::Fields::Unit => String::new(),
                    };
                    push_member(
                        &mut members,
                        &mut truncated,
                        RsMember {
                            kind: "variant".to_string(),
                            name: variant.ident.to_string(),
                            detail,
                        },
                    );
                }
                outcome.symbols.push(RsSymbol {
                    id: id.clone(),
                    kind: "enum".to_string(),
                    name: item_enum.ident.to_string(),
                    root_id: root_id.to_string(),
                    rel: rel.to_string(),
                    range: range_of(item_enum.ident.span()),
                    members,
                    members_truncated: truncated,
                });
                let mut seen = HashSet::new();
                for (target, span) in field_types {
                    if seen.insert(target.clone()) {
                        outcome.refs.push(PendingRef {
                            from: id.clone(),
                            kind: "references".to_string(),
                            to_name: target,
                            evidence: evidence_of(rel, span, "variant"),
                            ordinal: next(),
                        });
                    }
                }
            }
            syn::Item::Trait(item_trait) => {
                let mut next = || {
                    let current = *ordinal;
                    *ordinal += 1;
                    current
                };
                let id = symbol_id(root_id, rel, next());
                let mut members = Vec::new();
                let mut truncated = false;
                for item in &item_trait.items {
                    if let syn::TraitItem::Fn(method) = item {
                        push_member(
                            &mut members,
                            &mut truncated,
                            RsMember {
                                kind: "method".to_string(),
                                name: method.sig.ident.to_string(),
                                detail: fn_detail(&method.sig),
                            },
                        );
                    }
                }
                outcome.symbols.push(RsSymbol {
                    id,
                    kind: "trait".to_string(),
                    name: item_trait.ident.to_string(),
                    root_id: root_id.to_string(),
                    rel: rel.to_string(),
                    range: range_of(item_trait.ident.span()),
                    members,
                    members_truncated: truncated,
                });
            }
            syn::Item::Impl(item_impl) => {
                let mut next = || {
                    let current = *ordinal;
                    *ordinal += 1;
                    current
                };
                let type_name = short_text(&quote_to_string(&item_impl.self_ty), 60)
                    .split('<')
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .next_back()
                    .unwrap_or("")
                    .rsplit("::")
                    .next()
                    .unwrap_or("")
                    .to_string();
                if type_name.is_empty() {
                    continue;
                }
                let trait_name = item_impl.trait_.as_ref().and_then(|(_, path, _)| {
                    path.segments
                        .last()
                        .map(|segment| segment.ident.to_string())
                });
                let mut methods = Vec::new();
                for item in &item_impl.items {
                    if let syn::ImplItem::Fn(method) = item {
                        if methods.len() < MAX_STRUCTURE_MEMBERS {
                            methods.push(RsMember {
                                kind: "method".to_string(),
                                name: method.sig.ident.to_string(),
                                detail: fn_detail(&method.sig),
                            });
                        }
                    }
                }
                outcome.impls.push(ImplBlock {
                    type_name,
                    trait_name,
                    methods,
                    evidence: evidence_of(rel, item_impl.impl_token.span, "impl"),
                    ordinal: next(),
                });
            }
            _ => {}
        }
    }
    Ok(outcome)
}

/// Analyzes already-read Rust files. Deterministic, with global
/// uniqueness for resolution, like TypeScript.
pub fn analyze_rust_files(files: &[(String, String, String, String)]) -> RsStructure {
    let mut ordinal = 0usize;
    let mut symbols: Vec<RsSymbol> = Vec::new();
    let mut refs: Vec<PendingRef> = Vec::new();
    let mut impls: Vec<ImplBlock> = Vec::new();
    let mut endpoints: Vec<RsApiPoint> = Vec::new();
    let mut calls: Vec<RsApiPoint> = Vec::new();
    let mut rows: Vec<RsFile> = Vec::new();
    for (root_id, rel, content, hash) in files.iter().take(MAX_STRUCTURE_FILES) {
        match analyze_file(root_id, rel, content, &mut ordinal) {
            Ok(outcome) => {
                symbols.extend(outcome.symbols);
                refs.extend(outcome.refs);
                impls.extend(outcome.impls);
                endpoints.extend(outcome.endpoints);
                calls.extend(outcome.calls);
                rows.push(RsFile {
                    root_id: root_id.clone(),
                    rel: rel.clone(),
                    hash: hash.clone(),
                    bytes: content.len(),
                    status: "ok".to_string(),
                    message: None,
                });
            }
            Err(message) => {
                rows.push(RsFile {
                    root_id: root_id.clone(),
                    rel: rel.clone(),
                    hash: hash.clone(),
                    bytes: content.len(),
                    status: "error".to_string(),
                    message: Some(short_text(&message, 200)),
                });
            }
        }
    }

    let symbols_truncated = symbols.len() > MAX_STRUCTURE_SYMBOLS;
    symbols.truncate(MAX_STRUCTURE_SYMBOLS);
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, symbol) in symbols.iter().enumerate() {
        by_name.entry(symbol.name.clone()).or_default().push(index);
    }
    let unique = |name: &str| -> Option<usize> {
        by_name
            .get(name)
            .and_then(|list| if list.len() == 1 { Some(list[0]) } else { None })
    };

    // `impl` methods to the unique type; the rest, outside the subset.
    let mut extra_refs: Vec<PendingRef> = Vec::new();
    for block in impls {
        if let Some(index) = unique(&block.type_name) {
            let symbol = &mut symbols[index];
            for method in block.methods {
                let mut truncated = symbol.members_truncated;
                push_member(&mut symbol.members, &mut truncated, method);
                symbol.members_truncated = truncated;
            }
            if let Some(trait_name) = block.trait_name {
                extra_refs.push(PendingRef {
                    from: symbol.id.clone(),
                    kind: "implements".to_string(),
                    to_name: trait_name,
                    evidence: block.evidence.clone(),
                    ordinal: block.ordinal,
                });
            }
        }
    }
    refs.extend(extra_refs);

    let kept: HashSet<&str> = symbols.iter().map(|symbol| symbol.id.as_str()).collect();
    let mut relations: Vec<RsRelation> = Vec::new();
    let mut total_kept = 0usize;
    for pending in refs {
        if !kept.contains(pending.from.as_str()) {
            continue;
        }
        total_kept += 1;
        if relations.len() >= MAX_STRUCTURE_RELATIONS {
            continue;
        }
        let status = match by_name.get(pending.to_name.as_str()) {
            None => "unresolved",
            Some(list) if list.len() == 1 => "resolved",
            Some(_) => "ambiguous",
        };
        let to = if status == "resolved" {
            by_name
                .get(pending.to_name.as_str())
                .and_then(|list| list.first())
                .map(|index| symbols[*index].id.clone())
        } else {
            None
        };
        relations.push(RsRelation {
            id: format!(
                "rsrel:{}:{}:{}#{}",
                pending.from, pending.kind, pending.to_name, pending.ordinal
            ),
            kind: pending.kind,
            from: pending.from,
            to,
            to_name: pending.to_name,
            status: status.to_string(),
            evidence: pending.evidence,
        });
    }

    let endpoints_truncated = endpoints.len() > MAX_STRUCTURE_ENDPOINTS;
    endpoints.truncate(MAX_STRUCTURE_ENDPOINTS);
    let calls_truncated = calls.len() > MAX_STRUCTURE_CALLS;
    calls.truncate(MAX_STRUCTURE_CALLS);
    RsStructure {
        files: rows,
        symbols,
        relations,
        endpoints,
        calls,
        symbols_truncated,
        relations_truncated: total_kept > MAX_STRUCTURE_RELATIONS,
        endpoints_truncated,
        calls_truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analyze(rel: &str, content: &str) -> RsStructure {
        analyze_rust_files(&[(
            "root-1".to_string(),
            rel.to_string(),
            content.to_string(),
            fnv1a_hex(content),
        )])
    }

    #[test]
    fn fnv_matches_the_frontend() {
        assert_eq!(fnv1a_hex(""), "811c9dc5");
        assert_eq!(fnv1a_hex("hola"), "b2c65197");
        assert_eq!(fnv1a_hex("♥"), "40c382c3");
    }

    #[test]
    fn struct_enum_trait_and_impl() {
        let structure = analyze(
            "lib.rs",
            r#"
pub struct Person {
    pub name: String,
    pub age: u32,
}
pub enum State {
    Active,
    Inactive(String),
}
pub trait Greets {
    fn greet(&self) -> String;
}
impl Person {
    pub fn new_named(name: String) -> Self {
        Person { name, age: 0 }
    }
}
impl Greets for Person {
    fn greet(&self) -> String {
        self.name.clone()
    }
}
"#,
        );
        assert_eq!(structure.files[0].status, "ok");
        let kinds: Vec<(&str, &str)> = structure
            .symbols
            .iter()
            .map(|symbol| (symbol.kind.as_str(), symbol.name.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![("struct", "Person"), ("enum", "State"), ("trait", "Greets"),]
        );
        let person = &structure.symbols[0];
        assert!(person.members.iter().any(|member| member.name == "name"));
        assert!(person
            .members
            .iter()
            .any(|member| member.name == "new_named"));
        assert!(person.members.iter().any(|member| member.name == "greet"));
        let implements_rel = structure
            .relations
            .iter()
            .find(|rel| rel.kind == "implements")
            .expect("implements");
        assert_eq!(implements_rel.to_name, "Greets");
        assert_eq!(implements_rel.status, "resolved");
        assert_eq!(
            implements_rel.to.as_deref(),
            Some(structure.symbols[2].id.as_str())
        );
        assert!(implements_rel.evidence.contains("lib.rs"));
    }

    #[test]
    fn references_and_repeated_names() {
        let structure = analyze_rust_files(&[
            (
                "root-1".to_string(),
                "a.rs".to_string(),
                "pub struct Store { pub a: u32 }".to_string(),
                "h1".to_string(),
            ),
            (
                "root-1".to_string(),
                "b.rs".to_string(),
                "pub struct Store { pub b: u32 }\npub struct Uses { pub s: Store, pub other: Outsider }".to_string(),
                "h2".to_string(),
            ),
        ]);
        let ambiguous = structure
            .relations
            .iter()
            .find(|rel| rel.to_name == "Store")
            .expect("reference");
        assert_eq!(ambiguous.status, "ambiguous");
        assert_eq!(ambiguous.to, None);
        let external = structure
            .relations
            .iter()
            .find(|rel| rel.to_name == "Outsider")
            .expect("external");
        assert_eq!(external.status, "unresolved");
    }

    #[test]
    fn ignores_macros_uses_and_consts() {
        let structure = analyze(
            "lib.rs",
            r#"
use std::collections::HashMap;
pub const LIMIT: u32 = 10;
pub static mut COUNTER: u32 = 0;
#[derive(Debug, Clone)]
pub struct Point {
    pub values: HashMap<String, u32>,
}
macro_rules! ignore_it {
    () => {};
}
"#,
        );
        assert_eq!(structure.files[0].status, "ok");
        assert_eq!(structure.symbols.len(), 1);
        assert_eq!(structure.symbols[0].name, "Point");
        // `HashMap`/`String` are primitives/containers: no references.
        assert!(structure.relations.is_empty());
    }

    #[test]
    fn syntax_errors_do_not_hide_other_files() {
        let structure = analyze_rust_files(&[
            (
                "root-1".to_string(),
                "ok.rs".to_string(),
                "pub struct Ok;".to_string(),
                "h1".to_string(),
            ),
            (
                "root-1".to_string(),
                "mal.rs".to_string(),
                "pub struct Mal {".to_string(),
                "h2".to_string(),
            ),
        ]);
        assert_eq!(structure.files[0].status, "ok");
        assert_eq!(structure.files[1].status, "error");
        assert!(!structure.files[1]
            .message
            .as_deref()
            .unwrap_or("")
            .is_empty());
        assert_eq!(structure.symbols.len(), 1);
    }

    #[test]
    fn reproducible_result_and_1based_ranges() {
        let content = "pub struct A;\n\npub struct B {\n    pub a: A,\n}";
        let first = analyze("a.rs", content);
        let second = analyze("a.rs", content);
        assert_eq!(first, second);
        let b = first
            .symbols
            .iter()
            .find(|symbol| symbol.name == "B")
            .expect("B");
        assert_eq!(b.range.start_line, 3);
        assert_eq!(b.range.start_col, 12);
        let referencia = first
            .relations
            .iter()
            .find(|rel| rel.to_name == "A")
            .expect("ref");
        assert_eq!(referencia.status, "resolved");
        assert!(referencia.evidence.starts_with("a.rs:4"));
    }

    #[test]
    fn actix_and_axum_expose_endpoints() {
        let structure = analyze(
            "server.rs",
            r#"
use actix_web::get;
#[get("/users/{id}")]
async fn view() {}
#[post("/users")]
async fn create() {}
fn rutas() -> Router {
    Router::new()
        .route("/items", get(listar))
        .route("/items", post(crear).delete(borrar))
        .route(OTRA, get(x))
}
"#,
        );
        assert_eq!(structure.files[0].status, "ok");
        let points: Vec<(String, String)> = structure
            .endpoints
            .iter()
            .map(|point| (point.method.clone(), point.url.clone()))
            .collect();
        assert_eq!(
            points,
            vec![
                ("GET".to_string(), "/users/{id}".to_string()),
                ("POST".to_string(), "/users".to_string()),
                ("GET".to_string(), "/items".to_string()),
                ("POST".to_string(), "/items".to_string()),
                ("DELETE".to_string(), "/items".to_string()),
            ]
        );
        assert!(structure.endpoints[0].evidence.contains("server.rs"));
        assert!(structure.endpoints[0].evidence.contains("actix"));
        assert!(structure.endpoints[2].evidence.contains("axum"));
        assert!(structure.endpoints.iter().all(|point| point.note.is_none()));
        assert!(structure.calls.is_empty());
    }

    #[test]
    fn reqwest_calls_and_unknown_receivers_carry_a_note() {
        let structure = analyze(
            "client.rs",
            r#"
async fn fetch_it() {
    let a = reqwest::get("http://api/users").await;
    let b = client.post("/users").send().await;
    let c = reqwest::get(URL).await;
}
"#,
        );
        assert_eq!(structure.files[0].status, "ok");
        let points: Vec<(String, String)> = structure
            .calls
            .iter()
            .map(|point| (point.method.clone(), point.url.clone()))
            .collect();
        assert_eq!(
            points,
            vec![
                ("GET".to_string(), "http://api/users".to_string()),
                ("POST".to_string(), "/users".to_string()),
            ]
        );
        assert!(structure.calls[0].note.is_none());
        assert!(structure.calls[1]
            .note
            .as_ref()
            .is_some_and(|note| note.contains("unverified receiver")));
        assert!(structure.endpoints.is_empty());
    }

    #[test]
    fn route_without_methods_invents_no_endpoints() {
        let structure = analyze(
            "empty.rs",
            "fn r() { Router::new().route(\"/x\", handler); }",
        );
        assert_eq!(structure.files[0].status, "ok");
        assert!(structure.endpoints.is_empty());
        assert!(structure.calls.is_empty());
    }

    #[test]
    fn impl_of_external_type_is_skipped() {
        let structure = analyze(
            "lib.rs",
            "impl std::fmt::Display for Outsider {\n    fn fmt(&self) -> String { String::new() }\n}",
        );
        assert_eq!(structure.files[0].status, "ok");
        assert!(structure.symbols.is_empty());
        assert!(structure.relations.is_empty());
    }
}
