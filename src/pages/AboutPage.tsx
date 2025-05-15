import React from "react";

const AboutPage: React.FC = () => {
  return (
    <div>
      <h1>About</h1>
      <strong>What can I do on this website?</strong>
      <ul>
        <li>
          Convert an audio file to another format - MP3, AAC, WAV, Opus, Vorbis (in the .mka
          container), FLAC, ALAC, DTS, AC3 (Dolby Digital) or CAF.
        </li>
        <li>Convert a video to an audio-only file (to any of the above formats).</li>
        <li>Convert a video to the MP4 or MKV format.</li>
        <li>Change the audio codec of a video to MP3, AAC, AC3, DTS, WAV, FLAC or ALAC.</li>
      </ul>
    </div>
  );
};

export default AboutPage;
