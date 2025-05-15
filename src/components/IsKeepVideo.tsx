import React from "react";

interface IsKeepVideoProps {
  onIsKeepVideoChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isKeepVideo: boolean;
}

const IsKeepVideo: React.FC<IsKeepVideoProps> = ({ onIsKeepVideoChange, isKeepVideo }) => {
  return (
    <div id="keep_video_div" onChange={onIsKeepVideoChange}>
      <br />
      <div className="form-check">
        <label className="form-check-label">
          <input
            type="radio"
            onChange={onIsKeepVideoChange}
            className="form-check-input"
            value="yes"
            checked={isKeepVideo}
          />
          Keep the video (if applicable)
        </label>
      </div>
      <div className="form-check">
        <label className="form-check-label">
          <input
            type="radio"
            onChange={onIsKeepVideoChange}
            className="form-check-input"
            value="no"
            checked={!isKeepVideo}
          />
          I want an audio file
        </label>
      </div>
    </div>
  );
};

export default IsKeepVideo;
