import LabeledSlider from "../LabeledSlider";
import SettingNote from "../SettingNote";

interface QualitySliderProps {
  onSliderMoved: (value: string) => void;
  qValue: string;
}

const QualitySlider = ({ onSliderMoved, qValue }: QualitySliderProps) => (
  <div id="vorbis_quality_div">
    <LabeledSlider id="vorbis_quality" label="Quality" value={qValue} onChange={onSliderMoved}
      min={0} max={10} step={1} />
    <SettingNote>
      Quality range is from 0 (lowest) to 10 (highest). For more details, see the{" "}
      <a target="_blank" rel="noreferrer" className="underline"
        href="https://wiki.hydrogenaud.io/index.php?title=Recommended_Ogg_Vorbis#Recommended_Encoder_Settings">
        recommended encoder settings
      </a>{" "}
      and refer to the rows for -q 0 to -q 10.
    </SettingNote>
  </div>
);

export default QualitySlider;
