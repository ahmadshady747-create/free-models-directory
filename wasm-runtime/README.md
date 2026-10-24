# WebAssembly runtime — Model Execution Runtime

Rust source for the local prompt-preprocessing layer used by the
Model Execution Runtime (بيئة تنفيذ النماذج) in this directory.

It does NOT run models and does NOT do inference. Before a provider
request is sent, it analyses the visitor's prompt text in the browser
only: Unicode character count, word count, an estimated token count
(ceil(characters / 4) — an ESTIMATE, never any provider's tokenizer,
never used for billing), and a cleaned prompt with ASCII control
characters stripped except tab, newline and carriage return. The
cleaned prompt is what the existing playground code sends to the
provider. If WebAssembly cannot load, the same calculations run in
JavaScript and the UI says so honestly.

Rebuild command, run from `~/workspace/ai-api-directory/`:

```sh
PATH="$HOME/.cargo/bin:$PATH" rustc --target wasm32-unknown-unknown --crate-type cdylib -O wasm-runtime/src/lib.rs -o public/runtime.wasm
```

Then run `npm run build`. The binary is `public/runtime.wasm` and the
loader is `public/runtime.js`. No external Rust crates are used.
