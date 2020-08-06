/* eslint-env browser */
import invariant from 'invariant';

import {
  CameraType,
  CapturedPicture,
  ImageSize,
  ImageType,
  WebCameraSettings,
  CameraPictureOptions,
} from './Camera.types';
import * as CapabilityUtils from './WebCapabilityUtils';
import { CameraTypeToFacingMode, ImageTypeFormat, MinimumConstraints } from './WebConstants';
import { requestUserMediaAsync } from './WebUserMediaManager';

interface ConstrainLongRange {
  max?: number;
  min?: number;
  exact?: number;
  ideal?: number;
}

export function getImageSize(videoWidth: number, videoHeight: number, scale: number): ImageSize {
  const width = videoWidth * scale;
  const ratio = videoWidth / width;
  const height = videoHeight / ratio;

  return {
    width,
    height,
  };
}

export function toDataURL(
  canvas: HTMLCanvasElement,
  imageType: ImageType,
  quality: number
): string {
  invariant(
    Object.values(ImageType).includes(imageType),
    `expo-camera: ${imageType} is not a valid ImageType. Expected a string from: ${Object.values(
      ImageType
    ).join(', ')}`
  );

  const format = ImageTypeFormat[imageType];
  if (imageType === ImageType.jpg) {
    invariant(
      quality <= 1 && quality >= 0,
      `expo-camera: ${quality} is not a valid image quality. Expected a number from 0...1`
    );
    return canvas.toDataURL(format, quality);
  } else {
    return canvas.toDataURL(format);
  }
}

export function hasValidConstraints(
  preferredCameraType?: CameraType,
  width?: number | ConstrainLongRange,
  height?: number | ConstrainLongRange
): boolean {
  return preferredCameraType !== undefined && width !== undefined && height !== undefined;
}

function ensureCameraPictureOptions(config: CameraPictureOptions): CameraPictureOptions {
  const captureOptions = {
    scale: 1,
    imageType: ImageType.png,
    isImageMirror: false,
  };

  for (const key in config) {
    if (key in config && config[key] !== undefined && key in captureOptions) {
      captureOptions[key] = config[key];
    }
  }
  return captureOptions;
}

const DEFAULT_QUALITY = 0.92;

export function captureImage(
  video: HTMLVideoElement,
  pictureOptions: CameraPictureOptions
): string {
  const config = ensureCameraPictureOptions(pictureOptions);
  const { scale, imageType, quality = DEFAULT_QUALITY, isImageMirror } = config;

  const { videoWidth, videoHeight } = video;
  const { width, height } = getImageSize(videoWidth, videoHeight, scale!);

  // Build the canvas size and draw the camera image to the context from video
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    // Should never be called
    throw new Error('Context is not defined');
  }
  // Flip horizontally (as css transform: rotateY(180deg))
  if (isImageMirror) {
    context.setTransform(-1, 0, 0, 1, canvas.width, 0);
  }

  context.drawImage(video, 0, 0, width, height);

  const base64 = toDataURL(canvas, imageType!, quality);
  return base64;
}

function getSupportedConstraints(): MediaTrackSupportedConstraints | null {
  if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
    return navigator.mediaDevices.getSupportedConstraints();
  }
  return null;
}

export function getIdealConstraints(
  preferredCameraType: CameraType,
  width?: number | ConstrainLongRange,
  height?: number | ConstrainLongRange
): MediaStreamConstraints {
  const preferredConstraints: MediaStreamConstraints = {
    audio: false,
    video: {},
  };

  if (hasValidConstraints(preferredCameraType, width, height)) {
    return MinimumConstraints;
  }

  const supports = getSupportedConstraints();
  // TODO(Bacon): Test this
  if (!supports || !supports.facingMode || !supports.width || !supports.height)
    return MinimumConstraints;

  if (preferredCameraType && Object.values(CameraType).includes(preferredCameraType)) {
    const facingMode = CameraTypeToFacingMode[preferredCameraType];
    if (isWebKit()) {
      const key = facingMode === 'user' ? 'exact' : 'ideal';
      (preferredConstraints.video as MediaTrackConstraints).facingMode = {
        [key]: facingMode,
      };
    } else {
      (preferredConstraints.video as MediaTrackConstraints).facingMode = {
        ideal: CameraTypeToFacingMode[preferredCameraType],
      };
    }
  }

  if (isMediaTrackConstraints(preferredConstraints.video)) {
    preferredConstraints.video.width = width;
    preferredConstraints.video.height = height;
  }

  return preferredConstraints;
}

function isMediaTrackConstraints(input: any): input is MediaTrackConstraints {
  return input && typeof input.video !== 'boolean';
}

export async function getStreamDevice(
  preferredCameraType: CameraType,
  preferredWidth?: number | ConstrainLongRange,
  preferredHeight?: number | ConstrainLongRange
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = getIdealConstraints(
    preferredCameraType,
    preferredWidth,
    preferredHeight
  );
  const stream: MediaStream = await requestUserMediaAsync(constraints);
  return stream;
}

export function isWebKit(): boolean {
  return /WebKit/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
}

export function compareStreams(a: MediaStream | null, b: MediaStream | null): boolean {
  if (!a || !b) {
    return false;
  }
  const settingsA = a.getTracks()[0].getSettings();
  const settingsB = b.getTracks()[0].getSettings();
  return settingsA.deviceId === settingsB.deviceId;
}

export function capture(
  video: HTMLVideoElement,
  settings: MediaTrackSettings,
  config: CameraPictureOptions
): CapturedPicture {
  const base64 = captureImage(video, config);

  const capturedPicture: CapturedPicture = {
    uri: base64,
    base64,
    width: 0,
    height: 0,
  };

  if (settings) {
    const { width = 0, height = 0 } = settings;
    capturedPicture.width = width;
    capturedPicture.height = height;
    capturedPicture.exif = settings;
  }

  if (config.onPictureSaved) {
    config.onPictureSaved(capturedPicture);
  }
  return capturedPicture;
}

export async function syncTrackCapabilities(
  cameraType: CameraType,
  stream: MediaStream | null,
  settings: WebCameraSettings = {}
): Promise<void> {
  if (stream?.getVideoTracks) {
    await Promise.all(
      stream.getVideoTracks().map(track => onCapabilitiesReady(cameraType, track, settings))
    );
  }
}

// https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
async function onCapabilitiesReady(
  cameraType: CameraType,
  track: MediaStreamTrack,
  settings: WebCameraSettings = {}
): Promise<void> {
  const capabilities = track.getCapabilities();

  // Create an empty object because if you set a constraint that isn't available an error will be thrown.
  const constraints: MediaTrackConstraintSet = {};

  // TODO(Bacon): Add `pointsOfInterest` support
  const clampedValues = [
    'exposureCompensation',
    'colorTemperature',
    'iso',
    'brightness',
    'contrast',
    'saturation',
    'sharpness',
    'focusDistance',
    'zoom',
  ];

  for (const property of clampedValues) {
    if (capabilities[property]) {
      constraints[property] = convertNormalizedSetting(capabilities[property], settings[property]);
    }
  }

  function validatedInternalConstrainedValue<IConvertedType>(
    constraintKey: string,
    settingsKey: string,
    converter: (settingValue: any) => IConvertedType
  ) {
    const convertedSetting = converter(settings[settingsKey]);
    return validatedConstrainedValue({
      constraintKey,
      settingsKey,
      convertedSetting,
      capabilities,
      settings,
      cameraType,
    });
  }

  if (capabilities.focusMode && settings.autoFocus !== undefined) {
    constraints.focusMode = validatedInternalConstrainedValue<MediaTrackConstraintSet['focusMode']>(
      'focusMode',
      'autoFocus',
      CapabilityUtils.convertAutoFocusJSONToNative
    );
  }

  if (capabilities.torch && settings.flashMode !== undefined) {
    constraints.torch = validatedInternalConstrainedValue<MediaTrackConstraintSet['torch']>(
      'torch',
      'flashMode',
      CapabilityUtils.convertFlashModeJSONToNative
    );
  }

  if (capabilities.whiteBalanceMode && settings.whiteBalance !== undefined) {
    constraints.whiteBalanceMode = validatedInternalConstrainedValue<
      MediaTrackConstraintSet['whiteBalanceMode']
    >('whiteBalanceMode', 'whiteBalance', CapabilityUtils.convertWhiteBalanceJSONToNative);
  }

  await track.applyConstraints({ advanced: [constraints] });
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  if (stream.getAudioTracks) {
    stream.getAudioTracks().forEach(track => track.stop());
  }
  if (stream.getVideoTracks) {
    stream.getVideoTracks().forEach(track => track.stop());
  }
  if (isMediaStreamTrack(stream)) {
    stream.stop();
  }
}

export function setVideoSource(
  video: HTMLVideoElement,
  stream: MediaStream | MediaSource | Blob | null
): void {
  try {
    video.srcObject = stream;
  } catch {
    if (stream) {
      video.src = window.URL.createObjectURL(stream);
    } else if (typeof video.src === 'string') {
      window.URL.revokeObjectURL(video.src);
    }
  }
}

export function isCapabilityAvailable(video: HTMLVideoElement, keyName: string): boolean {
  const stream = video.srcObject;

  if (stream instanceof MediaStream) {
    const videoTrack = stream.getVideoTracks()[0];
    return Boolean(videoTrack.getCapabilities?.()?.[keyName]);
  }

  return false;
}

function isMediaStreamTrack(input: any): input is MediaStreamTrack {
  return typeof input.stop === 'function';
}

function convertNormalizedSetting(range: MediaSettingsRange, value?: number): number | undefined {
  if (!value) {
    return;
  }
  // convert the normalized incoming setting to the native camera zoom range
  const converted = convertRange(value, [range.min, range.max]);
  // clamp value so we don't get an error
  return Math.min(range.max, Math.max(range.min, converted));
}

function convertRange(value: number, r2: number[], r1: number[] = [0, 1]): number {
  return ((value - r1[0]) * (r2[1] - r2[0])) / (r1[1] - r1[0]) + r2[0];
}

function validatedConstrainedValue<T>(props: {
  constraintKey: string;
  settingsKey: string;
  convertedSetting: T;
  capabilities: MediaTrackCapabilities;
  settings: WebCameraSettings;
  cameraType: string;
}): T | undefined {
  const {
    constraintKey,
    settingsKey,
    convertedSetting,
    capabilities,
    settings,
    cameraType,
  } = props;
  const setting = settings[settingsKey];
  if (
    Array.isArray(capabilities[constraintKey]) &&
    convertedSetting &&
    !capabilities[constraintKey].includes(convertedSetting)
  ) {
    if (__DEV__) {
      // Only warn in dev mode.
      console.warn(
        ` { ${settingsKey}: "${setting}" } (converted to "${convertedSetting}" in the browser) is not supported for camera type "${cameraType}" in your browser. Using the default value instead.`
      );
    }
    return undefined;
  }
  return convertedSetting;
}
