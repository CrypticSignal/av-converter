import React, { useState, useRef } from 'react';
import { Routes, Route } from 'react-router';
import { useAppSelector } from './redux/hooks';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { convertFile } from './utils/convertFile';
import { createFFmpegArgs } from './utils/createFFmpegArgs';
// General Components
import BitrateSlider from './components/BitrateSlider';
import ConvertButton from './components/ConvertButton';
import FileInput from './components/FileInput';
import FormatSelector from './components/FormatSelector';
import IsKeepVideo from './components/IsKeepVideo';
import Navbar from './components/Navbar';
// Images
import ffmpegLogo from './images/ffmpeg-25.png';
import webAssemblyLogo from './images/webassembly-25.png';
// Output Format Related Components
import AC3 from './components/AC3';
import DTS from './components/Dts';
import FLAC from './components/Flac';
import H264 from './components/H264';
import MP3EncodingTypeSelector from './components/MP3/EncodingTypeSelector';
import NoSettingsApplicable from './components/NoSettingsApplicable';
import Opus from './components/Opus';
import VorbisEncodingType from './components/Vorbis/EncodingType';
import WavBitDepthSelector from './components/WavBitDepthSelector';
// Pages
import AboutPage from './pages/AboutPage';
import Filetypes from './pages/SupportedFiletypes';
// React-Bootstrap
import Container from 'react-bootstrap/Container';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Spinner from 'react-bootstrap/Spinner';
// Material UI
import {Alert, AlertColor} from '@mui/material';

const App: React.FC = () => {
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSeverity, setAlertSeverity] = useState<AlertColor>('info')
  const [file, setFile] = useState<File>();
  const [inputFilename, setInputFilename] = useState('');
  const [codec, setCodec] = useState('MP3');
  // Conversion progress.
  const [progress, setProgress] = useState(0);
  // AC3
  const [ac3Bitrate, setAc3Bitrate] = useState('640');
  // FLAC
  const [flacCompression, setFlacCompression] = useState('5');
  // Keep the video?
  const [isKeepVideo, setIsKeepVideo] = useState(false);
  // H.264/AVC
  const [crfValue, setCrfValue] = useState('18');
  const [transcodeAudio, setTranscodeAudio] = useState(true);
  const [transcodeVideo, setTranscodeVideo] = useState(true);
  const [videoBitrate, setVideoBitrate] = useState('8');
  const [videoContainer, setVideoContainer] = useState('mp4');
  const [videoEncodingType, setVideoEncodingType] = useState('crf');
  const [x264Preset, setX264Preset] = useState('superfast');
  // MP3
  const [mp3EncodingType, setMp3EncodingType] = useState('cbr');
  const [mp3VbrSetting, setMp3VbrSetting] = useState('0');
  // Opus
  const [opusEncodingType, setOpusEncodingType] = useState('vbr');
  // Vorbis
  const [vorbisEncodingType, setVorbisEncodingType] = useState('abr');
  const [qValue, setQValue] = useState('6');
  // WAV
  const [wavBitDepth, setWavBitDepth] = useState('16');

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.currentTarget.files![0]);
    const filename = e.currentTarget.files![0].name;
    setInputFilename(filename);
    const inputLabel = document.getElementById('file_input_label')!;
    const outputNameBox = document.getElementById('output_name') as HTMLInputElement;
    inputLabel.innerText = filename;
    outputNameBox.value = filename.split('.').slice(0, -1).join('.');
  };

  const onCodecChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCodec(e.currentTarget.value);
  };

  // AC3
  const onAc3BitrateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAc3Bitrate(e.currentTarget.value);
  };
  // FLAC
  const onFlacCompressionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFlacCompression(e.currentTarget.value);
  };
  // isKeepVideo
  const onIsKeepVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.currentTarget.value === 'yes' ? setIsKeepVideo(true) : setIsKeepVideo(false);
  };
  // H.264/AVC (MP4 or MKV container)
  const onTranscodeVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.currentTarget.value === 'yes' ? setTranscodeVideo(true) : setTranscodeVideo(false);
  };
  const onCrfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCrfValue(e.currentTarget.value);
  };
  const onTranscodeAudioCheckboxChange = () => {
    setTranscodeAudio(!transcodeAudio);
  };
  const onVideoContainerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setVideoContainer(e.currentTarget.value);
  };
  const onVideoBitrateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVideoBitrate(e.currentTarget.value);
  };
  const onVideoEncodingTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setVideoEncodingType(e.currentTarget.value);
  };
  const onX264PresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setX264Preset(e.currentTarget.value);
  };
  // MP3
  const onMp3EncodingTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMp3EncodingType(e.currentTarget.value);
  };
  const onMp3VbrSettingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMp3VbrSetting(e.currentTarget.value);
  };
  // Opus
  const onOpusEncodingTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setOpusEncodingType(e.currentTarget.value);
  };
  // Vorbis
  const onVorbisEncodingTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setVorbisEncodingType(e.currentTarget.value);
  };
  const onVorbisQualitySliderMoved = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQValue(e.currentTarget.value);
  };
  // WAV
  const onWavBitDepthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setWavBitDepth(e.currentTarget.value);
  };

  const bitrateSliderValue = useAppSelector((state) => state.bitrate.value);

  const ffmpegRef = useRef(new FFmpeg());
  const ffmpeg = ffmpegRef.current;

  const onConvertClicked = () => {
    if (file === undefined) {
      setAlertSeverity('error');
      setAlertMessage('You must choose an input file.');
      return;
    }

    console.clear();

    const conversionData = createFFmpegArgs(
      ac3Bitrate,
      bitrateSliderValue,
      codec,
      crfValue,
      flacCompression,
      isKeepVideo,
      inputFilename,
      mp3EncodingType,
      mp3VbrSetting,
      window.navigator.hardwareConcurrency, // numLogicalProcessors
      opusEncodingType,
      (document.getElementById('output_name') as HTMLInputElement).value,
      qValue,
      transcodeVideo,
      transcodeAudio,
      videoBitrate,
      videoContainer,
      videoEncodingType,
      vorbisEncodingType,
      wavBitDepth,
      x264Preset
    );

    if (conversionData === undefined) return;

    const { ffmpegArgs, outputFilename } = conversionData;
    
    if (outputFilename === inputFilename) {
      setAlertSeverity('error');
      setAlertMessage('Output filename cannot be same as the input filename.');
      return;
    }

    ffmpegArgs.unshift(inputFilename);
    ffmpegArgs.unshift('-i');
    ffmpegArgs.push(outputFilename);

    document.getElementById('convert_btn')!.style.display = 'none';
    
    convertFile(ffmpeg, file, ffmpegArgs, inputFilename, outputFilename, setProgress, setAlertMessage, setAlertSeverity);
  };

  const showFormatSettings = () => {
    switch (codec) {
      case 'AAC':
        return <BitrateSlider initialValue="192" min="32" max="256" step="32" />;
      case 'AC3':
        return (
          <div>
            <AC3 onAc3BitrateChange={onAc3BitrateChange} ac3Bitrate={ac3Bitrate} />
            <IsKeepVideo onIsKeepVideoChange={onIsKeepVideoChange} isKeepVideo={isKeepVideo} />
          </div>
        );
      case 'ALAC':
        return (
          <div>
            <NoSettingsApplicable />
            <IsKeepVideo onIsKeepVideoChange={onIsKeepVideoChange} isKeepVideo={isKeepVideo} />
          </div>
        );
      case 'CAF':
        return <NoSettingsApplicable />;
      case 'DTS':
        return (
          <div>
            <DTS />
            <IsKeepVideo onIsKeepVideoChange={onIsKeepVideoChange} isKeepVideo={isKeepVideo} />
          </div>
        );
      case 'FLAC':
        return (
          <div>
            <FLAC
              onFlacCompressionChange={onFlacCompressionChange}
              flacCompression={flacCompression}
            />
            <IsKeepVideo onIsKeepVideoChange={onIsKeepVideoChange} isKeepVideo={isKeepVideo} />
          </div>
        );
      case 'MKA':
        return (
          <i>
            Only the audio streams will be kept and left as-is (no transcoding will be done). The
            Matroska container will be used.
          </i>
        );

      case 'MP3':
        return (
          <div>
            <MP3EncodingTypeSelector
              onEncodingTypeChange={onMp3EncodingTypeChange}
              encodingType={mp3EncodingType}
              onVbrSettingChange={onMp3VbrSettingChange}
              vbrSetting={mp3VbrSetting}
            />
            <IsKeepVideo onIsKeepVideoChange={onIsKeepVideoChange} isKeepVideo={isKeepVideo} />
          </div>
        );
      case 'H264':
        return (
          <H264
            onVideoContainerChange={onVideoContainerChange}
            onTranscodeVideoChange={onTranscodeVideoChange}
            onCrfChange={onCrfChange}
            crfValue={crfValue}
            transcodeAudio={transcodeAudio}
            onTranscodeAudioCheckboxChange={onTranscodeAudioCheckboxChange}
            transcodeVideo={transcodeVideo}
            videoContainer={videoContainer}
            videoBitrate={videoBitrate}
            onVideoBitrateChange={onVideoBitrateChange}
            videoEncodingType={videoEncodingType}
            onVideoEncodingTypeChange={onVideoEncodingTypeChange}
            x264Preset={x264Preset}
            onX264PresetChange={onX264PresetChange}
          />
        );
      case 'Opus':
        return (
          <Opus
            onOpusEncodingTypeChange={onOpusEncodingTypeChange}
            encodingType={opusEncodingType}
          />
        );
      case 'Vorbis':
        return (
          <VorbisEncodingType
            onVorbisEncodingTypeChange={onVorbisEncodingTypeChange}
            vorbisEncodingType={vorbisEncodingType}
            onQualitySliderMoved={onVorbisQualitySliderMoved}
            qValue={qValue}
          />
        );
      case 'WAV':
        return (
          <WavBitDepthSelector onBitDepthChange={onWavBitDepthChange} bitDepth={wavBitDepth} />
        );
      default:
        return null;
    }
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          <>
            <Navbar />
            <h1>Audio / Video Converter</h1>
            <div id="powered_by">
              <i id="ffmpeg">Powered by FFmpeg</i>
              <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer">
                <img id="ffmpeg_logo" src={ffmpegLogo} alt="ffmpeg logo" />
              </a>
              <i id="webassembly">and WebAssembly</i>
              <a href="https://webassembly.org/" target="_blank" rel="noreferrer">
                <img src={webAssemblyLogo} alt="web assembly logo" />
              </a>
            </div>
            <Container>
              <FileInput onFileInput={onFileInput} />
              <i style={{ fontSize: '80%' }}>Max Filesize: 2 GB</i>
              <hr />

              <FormatSelector onCodecChange={onCodecChange} codec={codec} />
              <hr />

              <h5>Encoder Settings</h5>
              {showFormatSettings()}
              <br />
              <hr />

              <h5>Output Filename</h5>
              <input
                type="text"
                autoComplete="off"
                className="form-control"
                maxLength={200}
                id="output_name"
                required
              />

              <div id="converting_spinner" style={{ display: 'none' }}>
                <Spinner id="converting_btn" animation="border" />Converting...
              </div>

              <div id="conversion_progress" style={{ display: 'none' }}>
                <ProgressBar now={progress} label={`${progress}%`} />
              </div>

              <br />
              {alertMessage && <Alert severity={alertSeverity}>{alertMessage}</Alert>}

              <div id="convert_btn">
                <br />
                <ConvertButton onConvertClicked={onConvertClicked} />
              </div>
            </Container>
          </>
        }
      />

      <Route
        path="/about"
        element={
          <>
            <Navbar />
            <AboutPage />
          </>
        }
      />

      <Route
        path="/filetypes"
        element={
          <>
            <Navbar />
            <Filetypes />
          </>
        }
      />
    </Routes>
  );
};

export default App;