import Typography from '@mui/material/Typography';

/** A short explanation shown under an encoder setting. */
const SettingNote = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', my: 1 }}>
    {children}
  </Typography>
);

export default SettingNote;
