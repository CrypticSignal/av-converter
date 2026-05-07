import React, { useState, useRef } from 'react';
import { useAppSelector } from '../redux/hooks';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { convertFile } from '../utils/convertFile';
import { createFFmpegArgs, EncodingOptions } from '../utils/createFFmpegArgs';
// General Components
import BitrateSlider from '../components/BitrateSlider';
import ConvertButton from '../components/ConvertButton';
import FileInput from '../components/FileInput';
import FormatSelector from '../components/FormatSelector';
import IsKeepVideo from '../components/IsKeepVideo';
// Images
import ffmpegLogo from '../images/ffmpeg-25.png';
import webAssemblyLogo from '../images/webassembly-25.png';
// Output Format Related Components
import AC3 from '../components/AC3';
import DTS from '../components/Dts';
import FLAC from '../components/Flac';
import MP3EncodingTypeSelector from '../components/MP3/EncodingTypeSelector';
import NoSettingsApplicable from '../components/NoSettingsApplicable';
import Opus from '../components/Opus';
import VorbisEncodingType from '../components/Vorbis/EncodingType';
import WavBitDepthSelector from '../components/WavBitDepthSelector';
// Material UI
import Alert, { AlertColor } from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';

const Homepage = (): JSX.Element => {
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSeverity, setAlertSeverity] = useState<AlertColor>('info');
  const [codec, setCodec] = useState('MP3');
  const [ffmpegCommand, setFfmpegCommand] = useState('');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [inputFilename, setInputFilename] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [manualCommandInput, setManualCommandInput] = useState('');
  const [manualMode, setManualMode] = useState(false);
  // AC3
  const [ac3Bitrate, setAc3Bitrate] = useState('640');
  // FLAC
  const [flacCompression, setFlacCompression] = useState('5');
  // Keep the video?
  const [isKeepVideo, setIsKeepVideo] = useState(false);
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
  // Downmix to stereo?
  const [downmixToStereo, setDownmixToStereo] = useState(false);
  // Conversion progress.
  const [progress, setProgress] = useState(0);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files && e.currentTarget.files[0]) {
      const currentFile = e.currentTarget.files[0];
      setFile(currentFile);
      const filename = currentFile.name;
      setInputFilename(filename);
      const outputNameBox = document.getElementById('output_name') as HTMLInputElement;
      if (outputNameBox) {
        outputNameBox.value = filename.split('.').slice(0, -1).join('.');
      }
    } else {
      setInputFilename('');
      setFile(undefined);
    }
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
  const onDownmixToStereoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.currentTarget.value === 'yes' ? setDownmixToStereo(true) : setDownmixToStereo(false);
  };

  const bitrateSliderValue = useAppSelector((state) => state.bitrate.value);

  const ffmpegRef = useRef(new FFmpeg());
  const ffmpeg = ffmpegRef.current;

  const onConvertClicked = () => {
    if (file === undefined) {
      setAlertSeverity('error');
      setAlertMessage('You must select an input file.');
      return;
    }

    console.clear();
    setAlertMessage('');
    setProgress(0);
    setFfmpegCommand('');

    const outputNameElement = document.getElementById('output_name') as HTMLInputElement;
    const outputNameValue = outputNameElement ? outputNameElement.value : '';

    let ffmpegArgs: string[];
    let outputFilename = '';

    if (manualMode) {
      const restOfArgs = manualCommandInput.trim().split(' ');
      // https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597
      if (restOfArgs.includes('-c:v') || restOfArgs.includes('-c:V')) {
        if (!navigator.userAgent.toLowerCase().includes('firefox')) {
          restOfArgs.splice(-1, 0, "-threads", "4");
        }
      }

      if (restOfArgs.length === 0) {
        setAlertSeverity('error');
        setAlertMessage('Please enter the rest of the command.');
        setIsConverting(false);
        return;
      }

      ffmpegArgs = ['-i', inputFilename, ...restOfArgs];
      outputFilename = ffmpegArgs[ffmpegArgs.length - 1];
      
      if (!outputFilename) {
        setAlertSeverity('error');
        setAlertMessage('Could not parse output filename from command.');
        setIsConverting(false);
        return;
      }
    } else {
      let options: EncodingOptions;

      switch (codec) {
        case 'AAC':
          options = { codec: 'AAC', bitrateSliderValue, isKeepVideo, downmixToStereo };
          break;
        case 'AC3':
          options = { codec: 'AC3', ac3Bitrate, isKeepVideo, downmixToStereo };
          break;
        case 'ALAC':
          options = { codec: 'ALAC', isKeepVideo, downmixToStereo };
          break;
        case 'CAF':
          options = { codec: 'CAF', downmixToStereo };
          break;
        case 'DTS':
          options = { codec: 'DTS', bitrateSliderValue, isKeepVideo, downmixToStereo };
          break;
        case 'FLAC':
          options = { codec: 'FLAC', flacCompression, isKeepVideo, downmixToStereo };
          break;
        case 'MKA':
          options = { codec: 'MKA', downmixToStereo };
          break;
        case 'MP3':
          options = {
            codec: 'MP3',
            bitrateSliderValue,
            isKeepVideo,
            mp3EncodingType,
            mp3VbrSetting,
          };
          break;
        case 'Opus':
          options = { codec: 'Opus', bitrateSliderValue, opusEncodingType, downmixToStereo };
          break;
        case 'Vorbis':
          options = {
            codec: 'Vorbis',
            bitrateSliderValue,
            qValue,
            vorbisEncodingType,
            downmixToStereo,
          };
          break;
        case 'WAV':
          options = { codec: 'WAV', wavBitDepth, downmixToStereo };
          break;
        default:
          setAlertSeverity('error');
          setAlertMessage('Invalid codec selected.');
          setIsConverting(false);
          return;
      }

      const conversionData = createFFmpegArgs(inputFilename, options, outputNameValue);

      if (conversionData === undefined) {
        setIsConverting(false);
        setAlertSeverity('error');
        setAlertMessage('Failed to generate conversion settings. Check codec compatibility.');
        return;
      }

      ffmpegArgs = conversionData.ffmpegArgs;
      outputFilename = conversionData.outputFilename;
    }

    if (outputFilename === inputFilename) {
      setAlertSeverity('error');
      setAlertMessage('Output filename cannot be same as the input filename.');
      setIsConverting(false);
      return;
    }

    setFfmpegCommand(`ffmpeg ${ffmpegArgs.join(' ')}`);
    convertFile(ffmpeg, file, ffmpegArgs, inputFilename, outputFilename, setProgress, setAlertMessage, setAlertSeverity, setIsConverting);
  };

  const showFormatSettings = (): JSX.Element | null => {
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
    <>
        <div className="bg-black text-white text-center">
            <h1 className="text-4xl font-sans mt-0 mb-0 pt-5 pb-1">Audio / Video Converter</h1>
            <div className="text-sm mb-5 flex items-center justify-center">
                <i className="mr-1">Powered by FFmpeg</i>
                <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer" className="inline-block align-middle mr-1">
                <img src={ffmpegLogo} alt="ffmpeg logo" className="h-6 w-6" />
                </a>
                <i className="mr-1">and WebAssembly</i>
                <a href="https://webassembly.org/" target="_blank" rel="noreferrer" className="inline-block align-middle">
                <img src={webAssemblyLogo} alt="web assembly logo" className="h-6 w-6" />
                </a>
            </div>
        </div>
      <FileInput onFileInput={onFileInput} filename={inputFilename} />
      <Typography variant="caption" display="block">
        Max Filesize: 2 GB
      </Typography>
      <Divider sx={{ my: 2 }} />

      <div className="my-4 text-center">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="form-checkbox h-5 w-5 text-sky-600"
            checked={manualMode}
            onChange={(e) => setManualMode(e.target.checked)}
          />
          <span className="ml-2 text-black">Manual FFmpeg Command</span>
        </label>
      </div>

      <Divider sx={{ my: 2 }} />

      {manualMode ? (
        <div className="my-4 w-full max-w-xl mx-auto">
          <Typography variant="h5" component="h2" gutterBottom>
            Enter FFmpeg Command
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Enter the rest of the command (e.g. <code>-c:v libx264 output.mp4</code>).
          </Typography>
          <div className="flex items-stretch mt-1">
            <span
              className="bg-gray-200 border border-gray-300 border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis shrink-0 max-w-[150px] sm:max-w-[250px]"
              title={`ffmpeg -i "${inputFilename || 'input.mp4'}"`}
            >
              ffmpeg -i {inputFilename || 'input.mp4'}
            </span>
            <input
              type="text"
              className="flex-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-r-md text-sm shadow-sm placeholder-gray-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-black min-w-[100px]"
              value={manualCommandInput}
              onChange={(e) => setManualCommandInput(e.target.value)}
              placeholder="-c:v libx264 output.mp4"
            />
          </div>
        </div>
      ) : (
        <>
          <FormatSelector onCodecChange={onCodecChange} codec={codec} />
          <Divider sx={{ my: 2 }} />

          <Typography variant="h5" component="h2" gutterBottom>
            Encoder Settings
          </Typography>

          {showFormatSettings()}
          
          <div className="my-4">
            <Typography variant="subtitle1" component="h3" gutterBottom>
              Downmix to stereo?
            </Typography>
            <label className="mr-4">
              <input
                type="radio"
                name="downmix"
                value="yes"
                checked={downmixToStereo}
                onChange={onDownmixToStereoChange}
                className="mr-1"
              />
              Yes
            </label>
            <label>
              <input
                type="radio"
                name="downmix"
                value="no"
                checked={!downmixToStereo}
                onChange={onDownmixToStereoChange}
                className="mr-1"
              />
              No
            </label>
          </div>
          <Divider sx={{ my: 2 }} />

          <Typography variant="h5" component="h2" gutterBottom>
            Output Filename
          </Typography>
          <input
            type="text"
            autoComplete="off"
            className="mt-1 block w-full max-w-xs mx-auto px-3 py-2 bg-white border border-gray-300 rounded-md text-sm shadow-sm placeholder-gray-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:border-gray-200 disabled:shadow-none invalid:border-pink-500 invalid:text-pink-600 focus:invalid:border-pink-500 focus:invalid:ring-pink-500 text-black"
            maxLength={200}
            id="output_name"
          />
        </>
      )}

      <div className={`text-center my-4 ${isConverting ? 'block' : 'hidden'}`}>
        {ffmpegCommand && <>Running: {ffmpegCommand}...</>}
      </div>

      <div className={`my-4 w-full max-w-xs mx-auto ${isConverting && progress > 0 && progress < 100 ? 'block' : 'hidden'}`}>
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <Box sx={{ width: '100%', mr: 1 }}>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
          <Box sx={{ minWidth: 35 }}>
            <Typography variant="body2" color="text.secondary">{`${Math.round(progress)}%`}</Typography>
          </Box>
        </Box>
      </div>

      {alertMessage && <div className="w-full max-w-xs mx-auto"><Alert severity={alertSeverity} sx={{ textAlign: 'center', my: 2, display: 'flex', justifyContent: 'center' }}>{alertMessage}</Alert></div>}

      <div className={`mt-4 ${!isConverting ? 'block' : 'hidden'}`}>
        <ConvertButton onConvertClicked={onConvertClicked} />
      </div>
    </>
  );
};

export default Homepage;