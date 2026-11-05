import BitrateSlider, { type BitrateSliderProps } from "../BitrateSlider";
import SelectField from "../SelectField";
import SettingNote from "../SettingNote";
import QualitySlider from "./QualitySlider";

interface VorbisEncodingTypeProps {
  onVorbisEncodingTypeChange: (value: string) => void;
  vorbisEncodingType: string;
  onQualitySliderMoved: (value: string) => void;
  qValue: string;
  bitrate: BitrateSliderProps;
}

const ENCODING_TYPES = [["abr", "ABR (Average Bitrate)"], ["vbr", "VBR (target a quality level)"]] as const;

const VorbisEncodingType = ({
  onVorbisEncodingTypeChange,
  vorbisEncodingType,
  onQualitySliderMoved,
  qValue,
  bitrate,
}: VorbisEncodingTypeProps) => (
  <div id="Vorbis">
    <SelectField id="vorbis_encoding_type" label="Encoding type" value={vorbisEncodingType}
      onChange={onVorbisEncodingTypeChange} options={ENCODING_TYPES} />
    {vorbisEncodingType === "abr" && (
      <>
        <BitrateSlider {...bitrate} />
        <SettingNote>For mono audio, choose 224 kbps or less, or the conversion will fail.</SettingNote>
      </>
    )}
    {vorbisEncodingType === "vbr" && <QualitySlider onSliderMoved={onQualitySliderMoved} qValue={qValue} />}
  </div>
);

export default VorbisEncodingType;
