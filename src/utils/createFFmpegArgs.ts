export type EncodingOptions =
  | {
      codec: "AAC";
      bitrateSliderValue: string;
      isKeepVideo: boolean;
      downmixToStereo: boolean;
    }
  | {
      codec: "AC3";
      ac3Bitrate: string;
      isKeepVideo: boolean;
      downmixToStereo: boolean;
    }
  | {
      codec: "ALAC";
      isKeepVideo: boolean;
      downmixToStereo: boolean;
    }
  | {
      codec: "CAF";
      downmixToStereo: boolean;
    }
  | {
      codec: "DTS";
      bitrateSliderValue: string;
      isKeepVideo: boolean;
      downmixToStereo: boolean;
    }
  | {
      codec: "FLAC";
      flacCompression: string;
      isKeepVideo: boolean;
      downmixToStereo: boolean;
    }
  | {
      codec: "MKA";
      downmixToStereo: boolean;
    }
  | {
      codec: "MP3";
      bitrateSliderValue: string;
      isKeepVideo: boolean;
      mp3EncodingType: string;
      mp3VbrSetting: string;
    }
  | {
      codec: "Opus";
      bitrateSliderValue: string;
      opusEncodingType: string;
      downmixToStereo: boolean;
    }
  | {
      codec: "Vorbis";
      bitrateSliderValue: string;
      qValue: string;
      vorbisEncodingType: string;
      downmixToStereo: boolean;
    }
  | {
      codec: "WAV";
      wavBitDepth: string;
      downmixToStereo: boolean;
    };

interface ConversionData {
  ffmpegArgs: string[];
  outputFilename: string;
}

interface CodecHandlerResult {
  args: string[];
  outputFilename: string;
  isCopyAudio?: boolean;
}

const COPY_AUDIO_STREAM = ["-c:a", "copy"];
const COPY_VIDEO_STREAM = ["-c:V", "copy"];

const handleAAC = (options: Extract<EncodingOptions, { codec: "AAC" }>, outputName: string, ext: string): CodecHandlerResult => {
  const args = [];
  if (options.isKeepVideo) args.push(...COPY_VIDEO_STREAM);
  args.push("-c:a", "aac", "-b:a", `${options.bitrateSliderValue}k`);
  return { args, outputFilename: `${outputName}${options.isKeepVideo ? ext : ".aac"}` };
};

const handleAC3 = (options: Extract<EncodingOptions, { codec: "AC3" }>, outputName: string, ext: string): CodecHandlerResult => {
  const args = [];
  if (options.isKeepVideo) args.push(...COPY_VIDEO_STREAM);
  args.push("-c:a", "ac3", "-b:a", `${options.ac3Bitrate}k`);
  return { args, outputFilename: `${outputName}${options.isKeepVideo ? ext : ".ac3"}` };
};

const handleALAC = (options: Extract<EncodingOptions, { codec: "ALAC" }>, outputName: string): CodecHandlerResult => {
  const args = [];
  if (options.isKeepVideo) args.push(...COPY_VIDEO_STREAM);
  args.push("-c:a", "alac");
  return { args, outputFilename: `${outputName}.${options.isKeepVideo ? "mkv" : "m4a"}` };
};

const handleCAF = (options: Extract<EncodingOptions, { codec: "CAF" }>, outputName: string): CodecHandlerResult => {
  return { args: ["-c:a", "alac"], outputFilename: `${outputName}.caf` };
};

const handleDTS = (options: Extract<EncodingOptions, { codec: "DTS" }>, outputName: string, ext: string): CodecHandlerResult => {
  const args = [];
  if (options.isKeepVideo) args.push(...COPY_VIDEO_STREAM);
  args.push("-c:a", "dca", "-b:a", `${options.bitrateSliderValue}k`, "-strict", "-2");
  return { args, outputFilename: `${outputName}${options.isKeepVideo ? ext : ".dts"}` };
};

const handleFLAC = (options: Extract<EncodingOptions, { codec: "FLAC" }>, outputName: string): CodecHandlerResult => {
  const args = [];
  if (options.isKeepVideo) args.push("-map", "0", ...COPY_VIDEO_STREAM, "-c:s", "copy");
  args.push("-map", "0:a", "-c:a", "flac", "-compression_level", options.flacCompression);
  return { args, outputFilename: `${outputName}.${options.isKeepVideo ? "mkv" : "flac"}` };
};

const handleMKA = (outputName: string): CodecHandlerResult => {
  return { args: ["-map", "0:a", ...COPY_AUDIO_STREAM], outputFilename: `${outputName}.mka`, isCopyAudio: true };
};

const handleMP3 = (options: Extract<EncodingOptions, { codec: "MP3" }>, outputName: string, ext: string): CodecHandlerResult => {
  const outputFilename = `${outputName}${options.isKeepVideo ? (ext === ".mp4" ? ext : ".mkv") : ".mp3"}`;
  const args = [];
  if (options.isKeepVideo) args.push(...COPY_VIDEO_STREAM);
  args.push("-c:a", "libmp3lame");

  if (options.mp3EncodingType === "cbr") {
    args.push("-b:a", `${options.bitrateSliderValue}k`);
  } else if (options.mp3EncodingType === "abr") {
    args.push("--abr", "1", "-b:a", `${options.bitrateSliderValue}k`);
  } else { // VBR
    args.push("-q:a", options.mp3VbrSetting);
  }
  return { args, outputFilename };
};

const handleOpus = (options: Extract<EncodingOptions, { codec: "Opus" }>, outputName: string): CodecHandlerResult => {
  const args = ["-c:a", "libopus"];
  if (options.opusEncodingType === "cbr") {
    args.push("-vbr", "off");
  }
  args.push("-b:a", `${options.bitrateSliderValue}k`);
  return { args, outputFilename: `${outputName}.opus` };
};

const handleVorbis = (options: Extract<EncodingOptions, { codec: "Vorbis" }>, outputName: string): CodecHandlerResult => {
  const args = ["-map", "0:a", "-c:a", "libvorbis"];
  args.push(...(options.vorbisEncodingType === "abr" ? ["-b:a", `${options.bitrateSliderValue}k`] : ["-q:a", options.qValue]));
  return { args, outputFilename: `${outputName}.ogg` };
};

const handleWAV = (options: Extract<EncodingOptions, { codec: "WAV" }>, outputName: string): CodecHandlerResult => {
  return { args: ["-c:a", `pcm_s${options.wavBitDepth}le`], outputFilename: `${outputName}.wav` };
};

export const createFFmpegArgs = (
  inputFilename: string,
  options: EncodingOptions,
  outputName: string
): ConversionData | undefined => {
  const ext = inputFilename.substring(inputFilename.lastIndexOf("."));

  let result: CodecHandlerResult | undefined;

  switch (options.codec) {
    case "AAC":
      result = handleAAC(options, outputName, ext);
      break;
    case "AC3":
      result = handleAC3(options, outputName, ext);
      break;
    case "ALAC":
      result = handleALAC(options, outputName);
      break;
    case "CAF":
      result = handleCAF(options, outputName);
      break;
    case "DTS":
      result = handleDTS(options, outputName, ext);
      break;
    case "FLAC":
      result = handleFLAC(options, outputName);
      break;
    case "MKA":
      result = handleMKA(outputName);
      break;
    case "MP3":
      result = handleMP3(options, outputName, ext);
      break;
    case "Opus":
      result = handleOpus(options, outputName);
      break;
    case "Vorbis":
      result = handleVorbis(options, outputName);
      break;
    case "WAV":
      result = handleWAV(options, outputName);
      break;
  }

  if (!result) return undefined;

  const finalArgs = [...result.args];
  if ("downmixToStereo" in options && options.downmixToStereo && !result.isCopyAudio) {
    finalArgs.push("-ac", "2");
  }

  return {
    ffmpegArgs: ["-i", inputFilename, ...finalArgs, result.outputFilename],
    outputFilename: result.outputFilename,
  };
};
