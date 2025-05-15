import React from "react";

interface QualitySliderProps {
  onSliderMoved: (event: React.ChangeEvent<HTMLInputElement>) => void;
  qValue: string;
}

const QualitySlider: React.FC<QualitySliderProps> = ({ onSliderMoved, qValue }) => {
  return (
    <div id="vorbis_quality_div">
      <p>Set your desired quality setting via the slider:</p>
      <input
        type="range"
        className="slider"
        min={0}
        max={10}
        step={1}
        onChange={onSliderMoved}
        value={qValue}
      />
      <span>{qValue}</span>
      <br />
      <i>
        Quality range is from 0 (lowest) to 10 (highest). For more details, click
        <a
          target="_blank"
          rel="noreferrer"
          href="https://wiki.hydrogenaud.io/index.php?title=Recommended_Ogg_Vorbis#Recommended_Encoder_Settings"
        >
          here
        </a>
        and refer to the rows for -q 0 to -q 10.
      </i>
    </div>
  );
};

export default QualitySlider;
