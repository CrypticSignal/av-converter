import React from 'react';
import BitrateSlider from '../BitrateSlider';
import VbrDropdown from './VbrDropdown';

interface MP3EncodingTypeSelectorProps {
  onEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  encodingType: string;
  onVbrSettingChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  vbrSetting: string;
}

const MP3EncodingTypeSelector: React.FC<MP3EncodingTypeSelectorProps> = ({
  onEncodingTypeChange,
  encodingType,
  onVbrSettingChange,
  vbrSetting,
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
        <BitrateSlider initialValue='192' min='64' max='320' step='64' />
      )}
    </div>
  );
};

export default MP3EncodingTypeSelector;
