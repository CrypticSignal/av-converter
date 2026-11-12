// Extensions of video containers, for files the browser gives no MIME type (common for MKV and
// other less common formats, especially on Windows).
const VIDEO_EXTENSIONS = new Set([
  '3g2', '3gp', 'asf', 'avi', 'f4v', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg',
  'mts', 'ogv', 'rm', 'ts', 'vob', 'webm', 'wmv',
]);

/**
 * Whether the file looks like a video, from its MIME type or else its extension. Used to pick
 * the "Video" output type by default when such a file is selected.
 */
export const isVideoFile = (file: Pick<File, 'name' | 'type'>): boolean => {
  if (file.type.startsWith('video/')) return true;
  if (file.type.startsWith('audio/')) return false;
  const dot = file.name.lastIndexOf('.');
  return dot !== -1 && VIDEO_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
};
