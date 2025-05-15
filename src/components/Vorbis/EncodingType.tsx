import React from "react";
import BitrateSlider from "../BitrateSlider";
import QualitySlider from "./QualitySlider";

interface VorbisEncodingTypeProps {
  onVorbisEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  vorbisEncodingType: string;
  onQualitySliderMoved: (event: React.ChangeEvent<HTMLInputElement>) => void;
  qValue: string;
}

const VorbisEncodingType: React.FC<VorbisEncodingTypeProps> = ({
  onVorbisEncodingTypeChange,
  vorbisEncodingType,
  onQualitySliderMoved,
  qValue,
}) => {
  function renderComponent() {
    switch (vorbisEncodingType) {
      case "abr":
        return <BitrateSlider initialValue="192" min="32" max="512" step="32" />;
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
