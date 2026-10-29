import React from 'react';
import BitrateSlider, { type BitrateSliderProps } from '../BitrateSlider';
import VbrDropdown from './VbrDropdown';

interface MP3EncodingTypeSelectorProps {
  onEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  encodingType: string;
  onVbrSettingChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  vbrSetting: string;
  bitrate: BitrateSliderProps;
}

const MP3EncodingTypeSelector: React.FC<MP3EncodingTypeSelectorProps> = ({
  onEncodingTypeChange,
  encodingType,
  onVbrSettingChange,
  vbrSetting,
  bitrate,
}) => {
  return (
    <div id='mp3_encoding_div'>
      <label htmlFor='mp3_encoding_type'>Encoding Type:</label>
      <select
        value={encodingType}
        id='mp3_encoding_type'
        onChange={onEncodingTypeChange}
      >
        <option disabled>Select encoding type</option>
        <option value='cbr'>CBR (Constant Bitrate)</option>
        <option value='abr'>ABR (Average Bitrate)</option>
        <option value='vbr'>VBR (Variable Bitrate)</option>
      </select>
      {encodingType === 'vbr' ? (
        <VbrDropdown
          onVbrSettingChange={onVbrSettingChange}
          vbrSetting={vbrSetting}
        />
      ) : (
        <BitrateSlider {...bitrate} />
      )}
    </div>
  );
};

export default MP3EncodingTypeSelector;
