import SelectField from "../SelectField";

interface VbrDropdownProps {
  onVbrSettingChange: (value: string) => void;
  vbrSetting: string;
}

const SETTINGS = [
  ["0", "-V 0 (~240 kbps)"],
  ["1", "-V 1 (~220 kbps)"],
  ["2", "-V 2 (~190 kbps)"],
  ["3", "-V 3 (~170 kbps)"],
  ["4", "-V 4 (~160 kbps)"],
  ["5", "-V 5 (~130 kbps)"],
  ["6", "-V 6 (~120 kbps)"],
] as const;

const VbrDropdown = ({ onVbrSettingChange, vbrSetting }: VbrDropdownProps) => (
  <div>
    <SelectField id="mp3_vbr_setting" label="VBR setting" value={vbrSetting} onChange={onVbrSettingChange}
      options={SETTINGS}
      helperText={<>
        For more details about the settings, see the{" "}
        <a target="_blank" rel="noreferrer" className="underline"
          href="https://wiki.hydrogenaud.io/index.php?title=LAME#Recommended_settings_details">
          LAME recommended settings
        </a>.
      </>} />
  </div>
);

export default VbrDropdown;
