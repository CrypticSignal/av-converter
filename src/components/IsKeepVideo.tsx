import React from "react";

interface IsKeepVideoProps {
  onIsKeepVideoChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isKeepVideo: boolean;
}

const IsKeepVideo: React.FC<IsKeepVideoProps> = ({ onIsKeepVideoChange, isKeepVideo }) => {
  return (
    <div id="keep_video_div">
      <br />
      <label>
        <input
          className="mr-1"
          type="radio"
          onChange={onIsKeepVideoChange}
          value="yes"
          checked={isKeepVideo}
        />
        Keep the video (if applicable)
      </label>
      <label className="block">
        <input
          className="mr-1"
          type="radio"
          onChange={onIsKeepVideoChange}
          value="no"
          checked={!isKeepVideo}
        />
        I want an audio file
      </label>
    </div>
  );
};

export default IsKeepVideo;
