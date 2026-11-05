import SettingNote from "./SettingNote";

const NoSettingsApplicable = () => (
  <div id="no_settings_required">
    <SettingNote>You chose a format that does not require you to specify any encoder settings.</SettingNote>
  </div>
);

export default NoSettingsApplicable;
