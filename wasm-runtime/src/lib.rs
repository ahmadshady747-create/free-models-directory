//! Local prompt preprocessing for the Model Execution Runtime.
//!
//! This module does NOT run models, does NOT do inference, and does NOT
//! send anything anywhere. It only analyses text that is already in the
//! visitor's browser, before that text is sent to the provider by the
//! existing playground code:
//!   - count_chars: number of Unicode code points (a byte is counted
//!     only when it is NOT a UTF-8 continuation byte 10xxxxxx).
//!   - count_words: maximal runs of non-whitespace bytes, where
//!     whitespace is ASCII space, tab, newline, carriage return,
//!     vertical tab, or form feed.
//!   - estimate_tokens: ESTIMATE ONLY, documented formula:
//!     ceil(unicode_chars / 4). This is NOT any provider's tokenizer,
//!     it is NOT used for billing, and it must never be presented as a
//!     provider token count.
//!   - sanitize: copies the input to a separate output buffer, dropping
//!     ASCII control bytes (0x00-0x1F and 0x7F) except tab (0x09),
//!     newline (0x0A) and carriage return (0x0D). Control bytes are
//!     single bytes, so dropping them cannot break a multi-byte UTF-8
//!     sequence. Returns the cleaned byte length; the cleaned bytes are
//!     read back from output_ptr().
//!
//! Memory model (no allocator, no external crates): the host writes the
//! UTF-8 input into the buffer returned by input_ptr() (capacity from
//! input_capacity()), then calls the functions with that pointer and the
//! input length. sanitize() writes into the separate output buffer
//! returned by output_ptr(). Lengths larger than the capacity must be
//! rejected by the host (the JavaScript loader does this and falls back
//! to its own identical calculations), never truncated silently here
//! beyond the clamp that keeps the slice inside the buffer.
#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[panic_handler]
fn panic_handler(_info: &PanicInfo) -> ! {
    loop {}
}

const CAPACITY: usize = 262_144;

static mut INPUT: [u8; CAPACITY] = [0; CAPACITY];
static mut OUTPUT: [u8; CAPACITY] = [0; CAPACITY];

#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(INPUT).cast::<u8>()
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(OUTPUT).cast::<u8>()
}

#[no_mangle]
pub extern "C" fn input_capacity() -> u32 {
    CAPACITY as u32
}

fn as_slice<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    let len = core::cmp::min(len as usize, CAPACITY);
    if ptr.is_null() {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

fn is_whitespace(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C)
}

fn is_control(b: u8) -> bool {
    (b < 0x20 && b != b'\t' && b != b'\n' && b != b'\r') || b == 0x7F
}

#[no_mangle]
pub extern "C" fn count_chars(ptr: *const u8, len: u32) -> u32 {
    let bytes = as_slice(ptr, len);
    let mut n: u32 = 0;
    for &b in bytes {
        // A UTF-8 continuation byte is 10xxxxxx; every other byte starts
        // a new Unicode code point.
        if (b & 0xC0) != 0x80 {
            n += 1;
        }
    }
    n
}

#[no_mangle]
pub extern "C" fn count_words(ptr: *const u8, len: u32) -> u32 {
    let bytes = as_slice(ptr, len);
    let mut n: u32 = 0;
    let mut in_word = false;
    for &b in bytes {
        if is_whitespace(b) {
            in_word = false;
        } else if !in_word {
            in_word = true;
            n += 1;
        }
    }
    n
}

#[no_mangle]
pub extern "C" fn estimate_tokens(ptr: *const u8, len: u32) -> u32 {
    // ESTIMATE ONLY: ceil(chars / 4). See the module documentation above.
    let chars = count_chars(ptr, len);
    if chars == 0 {
        0
    } else {
        (chars + 3) / 4
    }
}

#[no_mangle]
pub extern "C" fn sanitize(ptr: *const u8, len: u32) -> u32 {
    let bytes = as_slice(ptr, len);
    let out = unsafe { core::slice::from_raw_parts_mut(core::ptr::addr_of_mut!(OUTPUT).cast::<u8>(), CAPACITY) };
    let mut n: usize = 0;
    for &b in bytes {
        if is_control(b) {
            continue;
        }
        if n < CAPACITY {
            out[n] = b;
            n += 1;
        }
    }
    n as u32
}
