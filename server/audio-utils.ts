/**
 * Audio utilities for G.711 mulaw conversion and resampling.
 * Used to bridge Twilio (8kHz mulaw) and Gemini Multimodal Live API (16kHz/24kHz PCM).
 */

// G.711 mulaw lookup tables
const DECODE_TABLE = new Int16Array(256);
const ENCODE_TABLE = new Uint8Array(65536);

function initTables() {
    for (let i = 0; i < 256; i++) {
        let mu = ~i;
        let sign = (mu & 0x80) ? -1 : 1;
        let exponent = (mu >> 4) & 0x07;
        let mantissa = mu & 0x0F;
        let sample = (mantissa << (exponent + 3)) + (132 << exponent) - 132;
        DECODE_TABLE[i] = sign * sample;
    }

    for (let i = -32768; i <= 32767; i++) {
        let sample = i;
        let sign = (sample < 0) ? 0x00 : 0x80;
        if (sample < 0) sample = -sample;
        sample += 132;
        if (sample > 32767) sample = 32767;

        let exponent = 7;
        let limit = 16383;
        while (exponent > 0 && sample <= limit) {
            exponent--;
            limit >>= 1;
        }
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        ENCODE_TABLE[i + 32768] = ~(sign | (exponent << 4) | mantissa);
    }
}

initTables();

/**
 * Converts a buffer of mulaw samples to 16-bit linear PCM.
 */
export function mulawToPcm(mulawBuffer: Buffer | Uint8Array): Int16Array {
    const pcm = new Int16Array(mulawBuffer.length);
    for (let i = 0; i < mulawBuffer.length; i++) {
        pcm[i] = DECODE_TABLE[mulawBuffer[i]];
    }
    return pcm;
}

/**
 * Converts 16-bit linear PCM samples to mulaw.
 */
export function pcmToMulaw(pcmBuffer: Int16Array | Buffer): Uint8Array {
    const mulaw = new Uint8Array(pcmBuffer.length);
    // If it's a Buffer, we treat it as Int16Array
    const samples = pcmBuffer instanceof Buffer 
        ? new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2)
        : pcmBuffer;

    for (let i = 0; i < samples.length; i++) {
        mulaw[i] = ENCODE_TABLE[samples[i] + 32768];
    }
    return mulaw;
}

/**
 * Poor man's resampler (linear interpolation/decimation).
 * 8kHz to 16kHz (Up-sampling by 2)
 */
export function resample8To16(pcm8: Int16Array): Int16Array {
    const pcm16 = new Int16Array(pcm8.length * 2);
    for (let i = 0; i < pcm8.length; i++) {
        pcm16[i * 2] = pcm8[i];
        // Linear interpolation between samples
        if (i < pcm8.length - 1) {
            pcm16[i * 2 + 1] = Math.round((pcm8[i] + pcm8[i + 1]) / 2);
        } else {
            pcm16[i * 2 + 1] = pcm8[i];
        }
    }
    return pcm16;
}

/**
 * Poor man's resampler (decimation).
 * 24kHz to 8kHz (Down-sampling by 3)
 */
export function resample24To8(pcm24: Int16Array): Int16Array {
    const pcm8 = new Int16Array(Math.floor(pcm24.length / 3));
    for (let i = 0; i < pcm8.length; i++) {
        // Simple decimation (pick every 3rd sample)
        // High-quality would use a low-pass filter first, but this is usually fine for voice
        pcm8[i] = pcm24[i * 3];
    }
    return pcm8;
}
