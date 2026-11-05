import BitrateSlider, { type BitrateSliderProps } from '../BitrateSlider';
import SelectField from '../SelectField';
import VbrDropdown from './VbrDropdown';

interface MP3EncodingTypeSelectorProps {
  onEncodingTypeChange: (value: string) => void;
  encodingType: string;
  onVbrSettingChange: (value: string) => void;
  vbrSetting: string;
  bitrate: BitrateSliderProps;
}

const ENCODING_TYPES = [
  ['cbr', 'CBR (Constant Bitrate)'],
  ['abr', 'ABR (Average Bitrate)'],
  ['vbr', 'VBR (Variable Bitrate)'],
] as const;

const MP3EncodingTypeSelector = ({
  onEncodingTypeChange,
  encodingType,
  onVbrSettingChange,
  vbrSetting,
  bitrate,
}: MP3EncodingTypeSelectorProps) => (
  <div id='mp3_encoding_div'>
    <SelectField id='mp3_encoding_type' label='Encoding type' value={encodingType}
      onChange={onEncodingTypeChange} options={ENCODING_TYPES} />
    {encodingType === 'vbr'
      ? <VbrDropdown onVbrSettingChange={onVbrSettingChange} vbrSetting={vbrSetting} />
      : <BitrateSlider {...bitrate} />}
  </div>
);

export default MP3EncodingTypeSelector;
