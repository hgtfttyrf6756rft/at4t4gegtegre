class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0];
            // Post the Float32Array data to the main thread
            this.port.postMessage(channelData);
        }
        return true; // keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
