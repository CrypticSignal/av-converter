import React from "react";

const SupportedFiletypes: React.FC = () => {
  return (
    <div>
      <h1>Supported Filetypes</h1>
      <br />
      <div className="audiofiletypes">
        <h3>Input Audio File</h3>
        <hr />
        <p>3GP (.3gp)</p>
        <p>AAC (.aac or .m4a)</p>
        <p>AC3 (.ac3)</p>
        <p>.adpcm</p>
        <p>.aif</p>
        <p>.aiff</p>
        <p>ALAC</p>
        <p>DTS (.dts)</p>
        <p>FLAC (.flac)</p>
        <p>MP3 (.mp3)</p>
        <p>.ogg</p>
        <p>Opus (.opus)</p>
        <p>Speex (.spx)</p>
        <p>Vorbis</p>
        <p>WAV (.wav)</p>
        <p>WMA (.wma)</p>
      </div>
      <div className="videofiletypes">
        <h3>Input Video File</h3>
        <hr />
        <p>AVI (.avi)</p>
        <p>FLV (.flv)</p>
        <p>MKV (.mkv)</p>
        <p>MOV (.mov)</p>
        <p>MP4 (.mp4)</p>
        <p>.MTS</p>
        <p>WebM (.webm)</p>
        <p>WMV (.wmv)</p>
      </div>
      <div className="outputformats">
        <h3>Output Formats</h3>
        <hr />
        <p>AAC (.m4a)</p>
        <p>AC3 (.ac3) [Dolby Digital]</p>
        <p>ALAC (.m4a)</p>
        <p>DTS (.dts)</p>
        <p>FLAC (.flac)</p>
        <p>MKA (.mka)</p>
        <p>MKV (.mkv)</p>
        <p>MP3 (.mp3)</p>
        <p>MP4 (.mp4)</p>
        <p>Opus (.opus)</p>
        <p>Vorbis (.ogg)</p>
        <p>WAV (.wav)</p>
      </div>
    </div>
  );
};

export default SupportedFiletypes;
