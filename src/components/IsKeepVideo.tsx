import YesNoRadio from "./YesNoRadio";

interface IsKeepVideoProps {
  onIsKeepVideoChange: (value: boolean) => void;
  isKeepVideo: boolean;
}

const IsKeepVideo = ({ onIsKeepVideoChange, isKeepVideo }: IsKeepVideoProps) => (
  <div id="keep_video_div">
    <YesNoRadio name="keep_video" label="Output" value={isKeepVideo} onChange={onIsKeepVideoChange}
      yesLabel="Keep the video (if applicable)" noLabel="I want an audio file" />
  </div>
);

export default IsKeepVideo;
