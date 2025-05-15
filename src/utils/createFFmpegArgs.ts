interface ConversionData {
  ffmpegArgs: string[];
  outputFilename: string;
}

const createConversionData = (
  encodingArgs: string,
  outputFilename: string
): ConversionData => {
  const encodingArgsArray = encodingArgs.split(" ");

  const ffmpegArgs = [
    "-metadata",
    "encoded_by=av-converter.com",
    "-id3v2_version",
    "3",
    "-write_id3v1",
    "true",
    ...encodingArgsArray,
  ];

  return {
    ffmpegArgs: ffmpegArgs,
    outputFilename: outputFilename,
  };
};

export const createFFmpegArgs = (
  ac3Bitrate: string,
  bitrateSliderValue: string,
  codec: string,
  crfValue: string,
  flacCompression: string,
  isKeepVideo: boolean,
  inputFilename: string,
  mp3EncodingType: string,
  mp3VbrSetting: string,
  numLogicalProcessors: number,
  opusEncodingType: string,
  outputName: string,
  qValue: string,
  transcodeVideo: boolean,
  transcodeAudio: boolean,
  videoBitrate: string,
  videoContainer: string,
  videoEncodingType: string,
  vorbisEncodingType: string,
  wavBitDepth: string,
  x264Preset: string
) => {
  const ext = inputFilename.substring(inputFilename.lastIndexOf("."));

  switch (codec) {
    case "AAC":
      return createConversionData(
        `${
          isKeepVideo ? "-c:v copy " : ""
        }-c:a aac -b:a ${bitrateSliderValue}k`,
        `${outputName}${isKeepVideo ? ext : ".aac"}`
      );

    case "AC3":
      return createConversionData(
        `${isKeepVideo ? "-c:v copy " : ""}-c:a ac3 -b:a ${ac3Bitrate}k`,
        `${outputName}${isKeepVideo ? ext : ".ac3"}`
      );

    case "ALAC":
      return createConversionData(
        `${isKeepVideo ? "-c:v copy " : ""}-c:a alac`,
        `${outputName}.${isKeepVideo ? "mkv" : "m4a"}`
      );

    case "CAF":
      return createConversionData(`-c:a alac`, `${outputName}.caf`);

    case "DTS":
      return createConversionData(
        `${
          isKeepVideo ? "-c:v copy " : ""
        }-c:a dca -b:a ${bitrateSliderValue}k -strict -2`,
        `${outputName}${isKeepVideo ? ext : ".dts"}`
      );

    case "FLAC":
      return createConversionData(
        `${
          isKeepVideo ? "-map 0 -c:v copy -c:s copy" : ""
        } -map 0:a -c:a flac -compression_level ${flacCompression}`,
        `${outputName}.${isKeepVideo ? "mkv" : "flac"}`
      );

    case "H264":
      const outputFilename = `${outputName}.${videoContainer}`;

      let args = "-map 0:V? -map 0:a? -map 0:s?";
      transcodeAudio ? (args += " -c:a aac -b:a 256k") : (args += " -c:a copy");

      if (!transcodeVideo) {
        videoContainer === "mp4"
          ? (args += " -c:V copy -f mp4")
          : (args += " -c:V copy -c:s copy -f matroska");

        return createConversionData(args, outputFilename);
      }

      // MP4 doesn't support all subtitle formats. Convert the subtitle tracks to mov_text which MP4 supports.
      if (videoContainer === "mp4") {
        args += " -c:s mov_text";
      }

      args += ` -c:V libx264 -preset ${x264Preset}`;

      videoEncodingType === "crf"
        ? (args += ` -crf ${crfValue}`)
        : (args += ` -b:v ${videoBitrate}M`);

      return createConversionData(args, outputFilename);

    case "MKA":
      return createConversionData(`-map 0:a -c:a copy`, `${outputName}.mka`);

    case "MP3":
      const outputExt = isKeepVideo ? (ext === ".mp4" ? ext : ".mkv") : ".mp3";

      if (mp3EncodingType === "cbr" || mp3EncodingType === "abr") {
        return createConversionData(
          `${isKeepVideo ? "-c:v copy " : ""}-c:a libmp3lame ${
            mp3EncodingType === "cbr" ? "" : "--abr 1"
          }-b:a ${bitrateSliderValue}k`,
          `${outputName}${outputExt}`
        );
      }

      // VBR
      return createConversionData(
        `${
          isKeepVideo ? "-c:v copy " : ""
        }-c:a libmp3lame -q:a ${mp3VbrSetting}`,
        `${outputName}${isKeepVideo ? outputExt : ".mp3"}`
      );

    case "Opus":
      return createConversionData(
        `-c:a libopus ${
          opusEncodingType === "cbr" ? "-vbr off " : ""
        }-b:a ${bitrateSliderValue}k`,
        `${outputName}.opus`
      );

    case "Vorbis":
      return createConversionData(
        `-map 0:a -c:a libvorbis ${
          vorbisEncodingType === "abr"
            ? `-b:a ${bitrateSliderValue}k`
            : `-q:a ${qValue}`
        }`,
        `${outputName}.ogg`
      );

    case "WAV":
      return createConversionData(
        `-c:a pcm_s${wavBitDepth}le`,
        `${outputName}.wav`
      );
  }
};
