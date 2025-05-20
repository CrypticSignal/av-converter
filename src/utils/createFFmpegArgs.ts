export interface EncodingOptions {
  ac3Bitrate: string;
  bitrateSliderValue: string;
  codec: string;
  crfValue: string;
  flacCompression: string;
  isKeepVideo: boolean;
  mp3EncodingType: string;
  mp3VbrSetting: string;
  opusEncodingType: string;
  qValue: string;
  transcodeVideo: boolean;
  transcodeAudio: boolean;
  videoBitrate: string;
  videoContainer: string;
  videoEncodingType: string;
  vorbisEncodingType: string;
  wavBitDepth: string;
  x264Preset: string;
}

interface ConversionData {
  ffmpegArgs: string[];
  outputFilename: string;
}

const returnConversionData = (
  inputFilename: string,
  encodingArgs: string[],
  outputFilename: string
): ConversionData => {
  return {
    ffmpegArgs: ["-i", inputFilename, ...encodingArgs, outputFilename],
    outputFilename,
  };
};

export const createFFmpegArgs = (
  inputFilename: string,
  options: EncodingOptions,
  outputName: string
): ConversionData | undefined => {
  const {
    ac3Bitrate,
    bitrateSliderValue,
    codec,
    crfValue,
    flacCompression,
    isKeepVideo,
    mp3EncodingType,
    mp3VbrSetting,
    opusEncodingType,
    qValue,
    transcodeVideo,
    transcodeAudio,
    videoBitrate,
    videoContainer,
    videoEncodingType,
    vorbisEncodingType,
    wavBitDepth,
    x264Preset,
  } = options;
  const ext = inputFilename.substring(inputFilename.lastIndexOf("."));
  let encodingArgs: string[] = [];

  const copyVideoStream = ["-c:V", "copy"];

  switch (codec) {
    case "AAC":
      if (isKeepVideo) encodingArgs.push(...copyVideoStream);
      encodingArgs.push(...["-c:a", "aac", "-b:a", `${bitrateSliderValue}k`]);
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}${isKeepVideo ? ext : ".aac"}`
      );

    case "AC3":
      if (isKeepVideo) encodingArgs.push(...copyVideoStream);
      encodingArgs.push(...["-c:a", "ac3", "-b:a", `${ac3Bitrate}k`]);
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}${isKeepVideo ? ext : ".ac3"}`
      );

    case "ALAC":
      if (isKeepVideo) encodingArgs.push(...copyVideoStream);
      encodingArgs.push(...["-c:a", "alac"]);
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}.${isKeepVideo ? "mkv" : "m4a"}`
      );

    case "CAF":
      encodingArgs.push(...["-c:a", "alac"]);
      return returnConversionData(inputFilename, encodingArgs, `${outputName}.caf`);

    case "DTS":
      if (isKeepVideo) encodingArgs.push(...copyVideoStream);
      encodingArgs.push(
        ...["-c:a", "dca", "-b:a", `${bitrateSliderValue}k`, "-strict", "-2"]
      );
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}${isKeepVideo ? ext : ".dts"}`
      );

    case "FLAC":
      if (isKeepVideo) encodingArgs.push(...["-map", "0", ...copyVideoStream, "-c:s", "copy"]);
      encodingArgs.push(
        ...["-map", "0:a", "-c:a", "flac", "-compression_level", flacCompression]
      );
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}.${isKeepVideo ? "mkv" : "flac"}`
      );

    case "H264":
      const h264OutputFilename = `${outputName}.${videoContainer}`;
      encodingArgs.push(...["-map", "0:V?", "-map", "0:a?", "-map", "0:s?"]);

      if (transcodeAudio) {
        encodingArgs.push(...["-c:a", "aac", "-b:a", "256k"]);
      } else {
        encodingArgs.push(...["-c:a", "copy"]);
      }

      if (!transcodeVideo) {
        encodingArgs.push(...copyVideoStream);
        if (videoContainer === "mp4") {
          encodingArgs.push(...["-f", "mp4"]);
        } else {
          encodingArgs.push(...["-c:s", "copy", "-f", "matroska"]);
        }
        return returnConversionData(inputFilename, encodingArgs, h264OutputFilename);
      }

      if (videoContainer === "mp4") {
        encodingArgs.push(...["-c:s", "mov_text"]);
      }

      encodingArgs.push(...["-c:V", "libx264", "-preset", x264Preset]);

      if (videoEncodingType === "crf") {
        encodingArgs.push(...["-crf", crfValue]);
      } else {
        encodingArgs.push(...["-b:v", `${videoBitrate}M`]);
      }
      return returnConversionData(inputFilename, encodingArgs, h264OutputFilename);

    case "MKA":
      encodingArgs.push(...["-map", "0:a", "-c:a", "copy"]);
      return returnConversionData(inputFilename, encodingArgs, `${outputName}.mka`);

    case "MP3":
      const mp3OutputExt = isKeepVideo ? (ext === ".mp4" ? ext : ".mkv") : ".mp3";
      if (isKeepVideo) encodingArgs.push(...copyVideoStream);
      encodingArgs.push(...["-c:a", "libmp3lame"]);

      if (mp3EncodingType === "cbr") {
        encodingArgs.push(...["-b:a", `${bitrateSliderValue}k`]);
      } else if (mp3EncodingType === "abr") {
        encodingArgs.push(...["--abr", "1", "-b:a", `${bitrateSliderValue}k`]);
      } else { // VBR
        encodingArgs.push(...["-q:a", mp3VbrSetting]);
      }
      return returnConversionData(
        inputFilename,
        encodingArgs,
        `${outputName}${mp3OutputExt}`
      );

    case "Opus":
      encodingArgs.push(...["-c:a", "libopus"]);
      if (opusEncodingType === "cbr") {
        encodingArgs.push(...["-vbr", "off"]);
      }
      encodingArgs.push(...["-b:a", `${bitrateSliderValue}k`]);
      return returnConversionData(inputFilename, encodingArgs, `${outputName}.opus`);

    case "Vorbis":
      encodingArgs.push(...["-map", "0:a", "-c:a", "libvorbis"]);
      if (vorbisEncodingType === "abr") {
        encodingArgs.push(...["-b:a", `${bitrateSliderValue}k`]);
      } else { // VBR
        encodingArgs.push(...["-q:a", qValue]);
      }
      return returnConversionData(inputFilename, encodingArgs, `${outputName}.ogg`);

    case "WAV":
      encodingArgs.push(...["-c:a", `pcm_s${wavBitDepth}le`]);
      return returnConversionData(inputFilename, encodingArgs, `${outputName}.wav`);
  }
};
