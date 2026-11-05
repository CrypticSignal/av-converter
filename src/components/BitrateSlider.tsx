import LabeledSlider from "./LabeledSlider";

export interface BitrateSliderProps {
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
  step: string;
}

const BitrateSlider = (props: BitrateSliderProps) =>
  <LabeledSlider id="bitrate_slider" label="Bitrate" unit="kbps" {...props} />;

export default BitrateSlider;
