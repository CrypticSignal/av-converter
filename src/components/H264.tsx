import React from "react";
import NumberInput from "./NumberInput";

interface H264Props {
  onVideoContainerChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  videoContainer: string;
  onTranscodeVideoChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  transcodeVideo: boolean;
  onTranscodeAudioCheckboxChange: () => void;
  transcodeAudio: boolean;
  onVideoEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  videoEncodingType: string;
  onX264PresetChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  x264Preset: string;
  onVideoBitrateChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  videoBitrate: string;
  onCrfChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  crfValue: string;
}

const H264: React.FC<H264Props> = ({
  onVideoContainerChange,
  videoContainer,
  onTranscodeVideoChange,
  transcodeVideo,
  onTranscodeAudioCheckboxChange,
  transcodeAudio,
  onVideoEncodingTypeChange,
  videoEncodingType,
  onX264PresetChange,
  x264Preset,
  onVideoBitrateChange,
  videoBitrate,
  onCrfChange,
  crfValue,
}) => {
  return (
    <div id="video">
      <label htmlFor="video_container">Output Container: </label>
      <select id="video_container" onChange={onVideoContainerChange} value={videoContainer}>
        <option value="mp4">MP4 (.mp4)</option>
        <option value="mkv">MKV (.mkv)</option>
      </select>
      <div id="should_transcode">
        <div className="form-check">
          <label className="form-check-label">
            <input
              type="radio"
              onChange={onTranscodeVideoChange}
              className="form-check-input"
              value="yes"
              checked={transcodeVideo}
            />
            Change the video codec to H.264/AVC
          </label>
        </div>
        <div className="form-check">
          <label className="form-check-label">
            <input
              type="radio"
              onChange={onTranscodeVideoChange}
              className="form-check-input"
              value="no"
              checked={!transcodeVideo}
            />
            Don't transcode the video but change the format to {videoContainer.toUpperCase()}
          </label>
        </div>
      </div>
      <input type="checkbox" onChange={onTranscodeAudioCheckboxChange} checked={transcodeAudio} />{" "}
      <label>Transcode the audio to AAC</label>
      <br />
      <i style={{ display: transcodeAudio ? "block" : "none" }}>
        The audio bitrate will be set to 256 kbps.
      </i>
      <div id="video_encoding_type" style={{ display: transcodeVideo ? "block" : "none" }}>
        <br />
        <label htmlFor="video_encoding_type">Encoding Type:</label>
        <select onChange={onVideoEncodingTypeChange} value={videoEncodingType}>
          <option value="crf">CRF (constant quality)</option>
          {/* <option value="filesize">Target a filesize</option> */}
          <option value="bitrate">Target a bitrate (Mbps)</option>
        </select>
      </div>
      <div id="x264_preset_div" style={{ display: transcodeVideo ? "block" : "none" }}>
        <label htmlFor="x264_preset">x264 preset:</label>
        <select onChange={onX264PresetChange} value={x264Preset}>
          <option value="veryslow">veryslow</option>
          <option value="slower">slower</option>
          <option value="slow">slow</option>
          <option value="medium">medium</option>
          <option value="fast">fast</option>
          <option value="superfast">superfast</option>
          <option value="ultrafast">ultrafast</option>
        </select>
      </div>
      <div
        id="target_bitrate_div"
        style={{ display: videoEncodingType === "bitrate" ? "block" : "none" }}
      >
        <NumberInput
          onVideoBitrateChange={onVideoBitrateChange}
          videoBitrate={videoBitrate}
          units="Mbps"
        />
      </div>
      {/* <div
        id="target_filesize_div"
        style={{ display: videoEncodingType === "filesize" ? "block" : "none" }}
      >
        <NumberInput
          onChange={onVideoFilesizeChange}
          value={videoFilesize}
          units="MB"
        />
      </div> */}
      <div
        id="crf_div"
        style={{ display: transcodeVideo && videoEncodingType === "crf" ? "block" : "none" }}
      >
        <strong>Constant Rate Factor (CRF)</strong>
        <br />
        <input
          type="range"
          className="slider"
          onChange={onCrfChange}
          min={0}
          max={51}
          step={1}
          value={crfValue}
        />
        <span id="crf_value" />
        {` ${crfValue}`}
        <br />
        <i>
          A lower CRF means higher video quality, at the expense of a larger file size. A CRF of 17
          or 18 is considered to be visually lossless or nearly so. More details{" "}
          <a href="https://trac.ffmpeg.org/wiki/Encode/H.264#crf" target="_blank" rel="noreferrer">
            here
          </a>
          .
        </i>
      </div>
    </div>
  );
};

export default H264;
