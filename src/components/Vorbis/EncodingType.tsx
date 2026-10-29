import React from "react";
import BitrateSlider, { type BitrateSliderProps } from "../BitrateSlider";
import QualitySlider from "./QualitySlider";

interface VorbisEncodingTypeProps {
  onVorbisEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  vorbisEncodingType: string;
  onQualitySliderMoved: (event: React.ChangeEvent<HTMLInputElement>) => void;
  qValue: string;
  bitrate: BitrateSliderProps;
}

const VorbisEncodingType: React.FC<VorbisEncodingTypeProps> = ({
  onVorbisEncodingTypeChange,
  vorbisEncodingType,
  onQualitySliderMoved,
  qValue,
  bitrate,
}) => {
  function renderComponent() {
    switch (vorbisEncodingType) {
      case "abr":
        return (
          <>
            <BitrateSlider {...bitrate} />
            <i>For mono audio, choose 224 kbps or less, or the conversion will fail.</i>
          </>
        );
      case "vbr":
        return <QualitySlider onSliderMoved={onQualitySliderMoved} qValue={qValue} />;
      default:
        return null;
    }
  }
  return (
    <div id="Vorbis">
      <div id="vorbis_encoding_div">
        <label>VBR setting:</label>
        <select onChange={onVorbisEncodingTypeChange} value={vorbisEncodingType}>
          <option disabled>Select encoding type</option>
          <option value="abr">ABR (Average Bitrate)</option>
          <option value="vbr">VBR (target a quality level)</option>
        </select>
        <br />
      </div>
      {renderComponent()}
    </div>
  );
};

export default VorbisEncodingType;
