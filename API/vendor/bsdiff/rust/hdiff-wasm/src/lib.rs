use bzip2::read::BzDecoder;
use bzip2::write::BzEncoder;
use bzip2::Compression;
use std::io::Cursor;
use std::io::Read;
use std::io::Write;

const MIN_HEADER_LEN: u32 = 128;
const EXEC_MAGIC_LO: u32 = 0x03BC_1FC6;
const EXEC_MAGIC_HI: u32 = 0x1F19_03C1;
const DELTA_MAGIC_LO: u32 = 0xFC43_E039;
const DELTA_MAGIC_HI: u32 = 0xE0E6_FC3E;

const OFFSET_VERSION: u32 = 8;
const OFFSET_FILE_LENGTH: u32 = 32;
const OFFSET_MAGIC_HI: u32 = 4;

const VALIDATE_OK: u32 = 0;
const VALIDATE_TOO_SMALL: u32 = 1;
const VALIDATE_INVALID_MAGIC: u32 = 2;
const VALIDATE_DELTA_MAGIC: u32 = 3;
const VALIDATE_INVALID_LENGTH: u32 = 4;

const STATUS_OK: u32 = 0;
const STATUS_INVALID_INPUT: u32 = 1;
const STATUS_PATCH_FAILED: u32 = 2;
const STATUS_INVALID_PATCH: u32 = 3;

static mut LAST_OUTPUT_PTR: *mut u8 = std::ptr::null_mut();
static mut LAST_OUTPUT_LEN: usize = 0;
static mut LAST_OUTPUT_CAP: usize = 0;

#[no_mangle]
pub unsafe extern "C" fn validate(ptr: u32, len: u32) -> u32 {
    if len < MIN_HEADER_LEN {
        return VALIDATE_TOO_SMALL;
    }

    let magic_lo = read_u32(ptr);
    let magic_hi = read_u32(ptr.wrapping_add(OFFSET_MAGIC_HI));

    if magic_lo == EXEC_MAGIC_LO {
        if magic_hi != EXEC_MAGIC_HI {
            return VALIDATE_INVALID_MAGIC;
        }
    } else {
        if magic_lo == DELTA_MAGIC_LO && magic_hi == DELTA_MAGIC_HI {
            return VALIDATE_DELTA_MAGIC;
        }
        return VALIDATE_INVALID_MAGIC;
    }

    let file_length = read_u32(ptr.wrapping_add(OFFSET_FILE_LENGTH));
    if file_length != len {
        return VALIDATE_INVALID_LENGTH;
    }

    VALIDATE_OK
}

#[no_mangle]
pub unsafe extern "C" fn version(ptr: u32) -> u32 {
    read_u32(ptr.wrapping_add(OFFSET_VERSION))
}

#[no_mangle]
pub extern "C" fn alloc(len: u32) -> u32 {
    let mut bytes = Vec::<u8>::with_capacity(len as usize);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr as u32
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: u32, len: u32) {
    if ptr == 0 || len == 0 {
        return;
    }

    drop(Vec::from_raw_parts(
        ptr as *mut u8,
        len as usize,
        len as usize,
    ));
}

#[no_mangle]
pub unsafe extern "C" fn create_patch(
    base_ptr: u32,
    base_len: u32,
    next_ptr: u32,
    next_len: u32,
) -> u32 {
    let base = match copy_input(base_ptr, base_len) {
        Ok(base) => base,
        Err(_) => return STATUS_INVALID_INPUT,
    };
    let next = match copy_input(next_ptr, next_len) {
        Ok(next) => next,
        Err(_) => return STATUS_INVALID_INPUT,
    };

    match generate_bsdiff40_patch(&base, &next) {
        Ok(patch) => {
            store_output(patch);
            STATUS_OK
        }
        Err(_) => STATUS_PATCH_FAILED,
    }
}

#[no_mangle]
pub unsafe extern "C" fn apply_patch(
    base_ptr: u32,
    base_len: u32,
    patch_ptr: u32,
    patch_len: u32,
) -> u32 {
    let base = match copy_input(base_ptr, base_len) {
        Ok(base) => base,
        Err(_) => return STATUS_INVALID_INPUT,
    };
    let patch = match copy_input(patch_ptr, patch_len) {
        Ok(patch) => patch,
        Err(_) => return STATUS_INVALID_INPUT,
    };

    match apply_bsdiff40_patch(&base, &patch) {
        Ok(next) => {
            store_output(next);
            STATUS_OK
        }
        Err(_) => STATUS_INVALID_PATCH,
    }
}

#[no_mangle]
pub extern "C" fn output_ptr() -> u32 {
    unsafe { LAST_OUTPUT_PTR as u32 }
}

#[no_mangle]
pub extern "C" fn output_len() -> u32 {
    unsafe { LAST_OUTPUT_LEN as u32 }
}

#[no_mangle]
pub extern "C" fn free_output() {
    unsafe {
        free_output_buffer();
    }
}

#[inline]
unsafe fn read_u32(ptr: u32) -> u32 {
    std::ptr::read_unaligned(ptr as *const u32)
}

unsafe fn copy_input(ptr: u32, len: u32) -> Result<Vec<u8>, ()> {
    if len == 0 {
        return Ok(Vec::new());
    }
    if ptr == 0 {
        return Err(());
    }

    let bytes = std::slice::from_raw_parts(ptr as *const u8, len as usize);
    Ok(bytes.to_vec())
}

fn store_output(bytes: Vec<u8>) {
    unsafe {
        free_output_buffer();

        let mut output = bytes;
        LAST_OUTPUT_PTR = output.as_mut_ptr();
        LAST_OUTPUT_LEN = output.len();
        LAST_OUTPUT_CAP = output.capacity();
        std::mem::forget(output);
    }
}

unsafe fn free_output_buffer() {
    if LAST_OUTPUT_PTR.is_null() {
        LAST_OUTPUT_LEN = 0;
        LAST_OUTPUT_CAP = 0;
        return;
    }

    drop(Vec::from_raw_parts(
        LAST_OUTPUT_PTR,
        LAST_OUTPUT_LEN,
        LAST_OUTPUT_CAP,
    ));
    LAST_OUTPUT_PTR = std::ptr::null_mut();
    LAST_OUTPUT_LEN = 0;
    LAST_OUTPUT_CAP = 0;
}

// Classic Colin Percival BSDIFF40 format: 8-byte "BSDIFF40" magic + 24 more
// header bytes (three i64 offsets: bzip2-control-len, bzip2-diff-len,
// new-file-size) + three SEPARATE bzip2 streams (control, diff, extra). This
// is exactly what expo-updates' on-device bspatch.c reads (memcmp "BSDIFF40",
// HEADER_SIZE 32, three BZ2_bzReadOpen streams).
//
// The `bsdiff` crate emits control/diff/extra INTERLEAVED into one stream
// (its own bsdiff43-style layout). We demux that self-describing stream back
// into the three logical sections, then bzip2-compress each independently and
// assemble the BSDIFF40 container. Pure Rust → compiles to wasm32.
const BSDIFF40_MAGIC: &[u8; 8] = b"BSDIFF40";

fn generate_bsdiff40_patch(old: &[u8], new: &[u8]) -> Result<Vec<u8>, String> {
    let mut interleaved = Vec::new();
    bsdiff::diff(old, new, &mut interleaved).map_err(|error| format!("{error}"))?;

    let (control, diff, extra) = demux_interleaved(&interleaved)?;
    let bz_control = bzip2_compress(&control)?;
    let bz_diff = bzip2_compress(&diff)?;
    let bz_extra = bzip2_compress(&extra)?;

    let mut patch = Vec::with_capacity(32 + bz_control.len() + bz_diff.len() + bz_extra.len());
    patch.extend_from_slice(BSDIFF40_MAGIC);
    write_offt(bz_control.len() as i64, &mut patch)?;
    write_offt(bz_diff.len() as i64, &mut patch)?;
    write_offt(new.len() as i64, &mut patch)?;
    patch.extend_from_slice(&bz_control);
    patch.extend_from_slice(&bz_diff);
    patch.extend_from_slice(&bz_extra);

    Ok(patch)
}

// Split the `bsdiff` crate's interleaved output into (control, diff, extra).
// Layout per block: 24-byte control triple, then ctrl[0] diff bytes, then
// ctrl[1] extra bytes. Self-describing, so we just walk it.
fn demux_interleaved(buf: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    let mut control = Vec::new();
    let mut diff = Vec::new();
    let mut extra = Vec::new();
    let mut pos = 0usize;

    while pos < buf.len() {
        if pos + 24 > buf.len() {
            return Err("truncated control triple".to_string());
        }
        let triple = &buf[pos..pos + 24];
        control.extend_from_slice(triple);
        let diff_len = offtin(&triple[0..8]);
        let extra_len = offtin(&triple[8..16]);
        pos += 24;

        if diff_len < 0 || extra_len < 0 {
            return Err("negative control length".to_string());
        }
        let diff_len = diff_len as usize;
        let extra_len = extra_len as usize;

        if pos + diff_len > buf.len() {
            return Err("truncated diff bytes".to_string());
        }
        diff.extend_from_slice(&buf[pos..pos + diff_len]);
        pos += diff_len;

        if pos + extra_len > buf.len() {
            return Err("truncated extra bytes".to_string());
        }
        extra.extend_from_slice(&buf[pos..pos + extra_len]);
        pos += extra_len;
    }

    Ok((control, diff, extra))
}

fn apply_bsdiff40_patch(old: &[u8], patch: &[u8]) -> Result<Vec<u8>, String> {
    if patch.len() < 32 || &patch[0..8] != BSDIFF40_MAGIC {
        return Err("invalid BSDIFF40 header".to_string());
    }

    let ctrl_len = offtin(&patch[8..16]);
    let diff_len = offtin(&patch[16..24]);
    let new_size = offtin(&patch[24..32]);
    if ctrl_len < 0 || diff_len < 0 || new_size < 0 {
        return Err("negative BSDIFF40 header value".to_string());
    }
    let ctrl_len = ctrl_len as usize;
    let diff_len = diff_len as usize;
    let new_size = new_size as usize;

    let ctrl_start = 32usize;
    let diff_start = ctrl_start
        .checked_add(ctrl_len)
        .ok_or("control length overflow")?;
    let extra_start = diff_start
        .checked_add(diff_len)
        .ok_or("diff length overflow")?;
    if extra_start > patch.len() {
        return Err("BSDIFF40 streams exceed patch size".to_string());
    }

    let control = bzip2_decompress(&patch[ctrl_start..diff_start])?;
    let diff = bzip2_decompress(&patch[diff_start..extra_start])?;
    let extra = bzip2_decompress(&patch[extra_start..])?;

    // Re-interleave into the `bsdiff` crate's layout and reuse its tested patch().
    let mut interleaved = Vec::with_capacity(control.len() + diff.len() + extra.len());
    let mut cpos = 0usize;
    let mut dpos = 0usize;
    let mut epos = 0usize;
    while cpos < control.len() {
        if cpos + 24 > control.len() {
            return Err("truncated control stream".to_string());
        }
        let triple = &control[cpos..cpos + 24];
        let d = offtin(&triple[0..8]);
        let e = offtin(&triple[8..16]);
        if d < 0 || e < 0 {
            return Err("negative control length".to_string());
        }
        let d = d as usize;
        let e = e as usize;
        interleaved.extend_from_slice(triple);
        cpos += 24;

        if dpos + d > diff.len() {
            return Err("diff stream underflow".to_string());
        }
        interleaved.extend_from_slice(&diff[dpos..dpos + d]);
        dpos += d;

        if epos + e > extra.len() {
            return Err("extra stream underflow".to_string());
        }
        interleaved.extend_from_slice(&extra[epos..epos + e]);
        epos += e;
    }

    let mut output = Vec::with_capacity(new_size);
    bsdiff::patch(old, &mut Cursor::new(interleaved), &mut output)
        .map_err(|error| format!("{error}"))?;

    if output.len() != new_size {
        return Err("patch output length mismatch".to_string());
    }

    Ok(output)
}

fn bzip2_compress(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = BzEncoder::new(Vec::new(), Compression::new(9));
    encoder.write_all(input).map_err(|error| format!("{error}"))?;
    encoder.finish().map_err(|error| format!("{error}"))
}

fn bzip2_decompress(input: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = BzDecoder::new(input);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|error| format!("{error}"))?;
    Ok(out)
}

// Colin Percival's offtin: 8-byte little-endian magnitude with the high bit of
// the last byte as sign. Matches expo bspatch.c offtin and the `bsdiff` crate's
// offtout encoding.
fn offtin(buf: &[u8]) -> i64 {
    let mut y = (buf[7] & 0x7f) as i64;
    for i in (0..7).rev() {
        y = y * 256 + buf[i] as i64;
    }
    if buf[7] & 0x80 != 0 {
        y = -y;
    }
    y
}

// offtout for non-negative values (all BSDIFF40 header fields are lengths/sizes,
// always >= 0). For non-negative values this equals plain little-endian i64.
fn write_offt(value: i64, out: &mut Vec<u8>) -> Result<(), String> {
    if value < 0 {
        return Err("negative header value".to_string());
    }
    out.extend_from_slice(&value.to_le_bytes());
    Ok(())
}
