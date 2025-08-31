/*
Repl.jsx - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { code2hash, getPerformanceTimeSeconds, logger, silence } from '@strudel/core';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import {
  getAudioContextCurrentTime,
  webaudioOutput,
  resetGlobalEffects,
  resetLoadedSounds,
  initAudioOnFirstClick,
  resetDefaults,
} from '@strudel/webaudio';
import { setVersionDefaultsFrom } from './util.mjs';
import { StrudelMirror, defaultSettings } from '@strudel/codemirror';
import { clearHydra } from '@strudel/hydra';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseBoolean, settingsMap, useSettings } from '../settings.mjs';
import {
  setActivePattern,
  setLatestCode,
  createPatternID,
  userPattern,
  getViewingPatternData,
  setViewingPatternData,
} from '../user_pattern_utils.mjs';
import { superdirtOutput } from '@strudel/osc/superdirtoutput';
import { audioEngineTargets } from '../settings.mjs';
import { useStore } from '@nanostores/react';
import { prebake } from './prebake.mjs';
import { getRandomTune, initCode, loadModules, shareCode } from './util.mjs';
import './Repl.css';
import { setInterval, clearInterval } from 'worker-timers';
import { getMetadata } from '../metadata_parser';
import { startRecording, stopRecording } from '@strudel/webaudio';
import { saveSampleBlobToDB } from './idbutils.mjs';

const { latestCode, maxPolyphony, audioDeviceName, multiChannelOrbits } = settingsMap.get();
let modulesLoading, presets, drawContext, clearCanvas, audioReady;

if (typeof window !== 'undefined') {
  audioReady = initAudioOnFirstClick({
    maxPolyphony,
    audioDeviceName,
    multiChannelOrbits: parseBoolean(multiChannelOrbits),
  });
  modulesLoading = loadModules();
  presets = prebake();
  drawContext = getDrawContext();
  clearCanvas = () => drawContext.clearRect(0, 0, drawContext.canvas.height, drawContext.canvas.width);
}

async function getModule(name) {
  if (!modulesLoading) {
    return;
  }
  const modules = await modulesLoading;
  return modules.find((m) => m.packageName === name);
}

const initialCode = `// LOADING`;

export function useReplContext() {
  const { isSyncEnabled, audioEngineTarget, recordOnNextPlay } = useSettings();
  const shouldUseWebaudio = audioEngineTarget !== audioEngineTargets.osc;
  const defaultOutput = shouldUseWebaudio ? webaudioOutput : superdirtOutput;
  const getTime = shouldUseWebaudio ? getAudioContextCurrentTime : getPerformanceTimeSeconds;

  const init = useCallback(() => {
    const drawTime = [-2, 2];
    const drawContext = getDrawContext();
    const editor = new StrudelMirror({
      sync: isSyncEnabled,
      defaultOutput,
      getTime,
      setInterval,
      clearInterval,
      transpiler,
      autodraw: false,
      root: containerRef.current,
      initialCode,
      pattern: silence,
      drawTime,
      drawContext,
      prebake: async () => Promise.all([modulesLoading, presets]),
      onUpdateState: (state) => {
        setReplState({ ...state });
      },
      onToggle: (playing) => {
        if (!playing) {
          clearHydra();
        }
      },
      beforeEval: () => audioReady,
      afterEval: (all) => {
        const { code } = all;
        //post to iframe parent (like Udels) if it exists...
        window.parent?.postMessage(code);

        setLatestCode(code);
        window.location.hash = '#' + code2hash(code);
        setDocumentTitle(code);
        const viewingPatternData = getViewingPatternData();
        setVersionDefaultsFrom(code);
        const data = { ...viewingPatternData, code };
        let id = data.id;
        const isExamplePattern = viewingPatternData.collection !== userPattern.collection;

        if (isExamplePattern) {
          const codeHasChanged = code !== viewingPatternData.code;
          if (codeHasChanged) {
            // fork example
            const newPattern = userPattern.duplicate(data);
            id = newPattern.id;
            setViewingPatternData(newPattern.data);
          }
        } else {
          id = userPattern.isValidID(id) ? id : createPatternID();
          setViewingPatternData(userPattern.update(id, data).data);
        }
        setActivePattern(id);
      },
      bgFill: false,
    });
    window.strudelMirror = editor;

    // init settings
    initCode().then(async (decoded) => {
      let code, msg;
      if (decoded) {
        code = decoded;
        msg = `I have loaded the code from the URL.`;
      } else if (latestCode) {
        code = latestCode;
        msg = `Your last session has been loaded!`;
      } else {
        /* const { code: randomTune, name } = await getRandomTune();
        code = randomTune; */
        code = '$: s("[bd <hh oh>]*2").bank("tr909").dec(.4)';
        msg = `Default code has been loaded`;
      }
      editor.setCode(code);
      setDocumentTitle(code);
      logger(`Welcome to Strudel! ${msg} Press play or hit ctrl+enter to run it!`, 'highlight');
    });

    editorRef.current = editor;
  }, []);

  const [replState, setReplState] = useState({});
  const { started, isDirty, error, activeCode, pending } = replState;
  const editorRef = useRef();
  const containerRef = useRef();
  const [recording, setRecording] = useState(false);
  const [lastRecordingUrl, setLastRecordingUrl] = useState();
  const [recordings, setRecordings] = useState([]); // [{ url, createdAt, size, mimeType }]
  const [patternRecordings, setPatternRecordings] = useState({}); // id -> [{url, createdAt, size, mimeType}]

  // this can be simplified once SettingsTab has been refactored to change codemirrorSettings directly!
  // this will be the case when the main repl is being replaced
  const _settings = useStore(settingsMap, { keys: Object.keys(defaultSettings) });
  useEffect(() => {
    let editorSettings = {};
    Object.keys(defaultSettings).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(_settings, key)) {
        editorSettings[key] = _settings[key];
      }
    });
    editorRef.current?.updateSettings(editorSettings);
  }, [_settings]);

  //
  // UI Actions
  //

  const setDocumentTitle = (code) => {
    const meta = getMetadata(code);
    document.title = (meta.title ? `${meta.title} - ` : '') + 'Strudel REPL';
  };

  const handleTogglePlay = async () => {
    const next = !started;
    // If recordOnNextPlay is armed, begin recording on the next start
    if (next && recordOnNextPlay && !recording) {
      try {
        await audioReady;
        startRecording();
        setRecording(true);
        logger('[repl] ⏺ recording started');
        settingsMap.setKey('recordOnNextPlay', false);
      } catch {}
    }
    // Do not auto-stop/save on stop; user will press Stop Recording
    editorRef.current?.toggle();
  };

  const resetEditor = async () => {
    (await getModule('@strudel/tonal'))?.resetVoicings();
    resetDefaults();
    resetGlobalEffects();
    clearCanvas();
    clearHydra();
    resetLoadedSounds();
    editorRef.current.repl.setCps(0.5);
    await prebake(); // declare default samples
  };

  const handleUpdate = async (patternData, reset = false) => {
    setViewingPatternData(patternData);
    editorRef.current.setCode(patternData.code);
    if (reset) {
      await resetEditor();
      handleEvaluate();
    }
  };

  const handleEvaluate = () => {
    editorRef.current.evaluate();
  };
  const handleShuffle = async () => {
    const patternData = await getRandomTune();
    const code = patternData.code;
    logger(`[repl] ✨ loading random tune "${patternData.id}"`);
    setActivePattern(patternData.id);
    setViewingPatternData(patternData);
    await resetEditor();
    editorRef.current.setCode(code);
    editorRef.current.repl.evaluate(code);
  };

  const handleShare = async () => shareCode(replState.code);
  const handleArmRecordOnNextPlay = () => {
    settingsMap.setKey('recordOnNextPlay', true);
    logger('[repl] ⏺ will start recording on next play');
  };

  const handleStopAndSaveRecording = async () => {
    try {
      const blob = await stopRecording();
      const url = URL.createObjectURL(blob);
      setLastRecordingUrl(url);
      setRecording(false);
      setRecordings((list) =>
        [{ url, createdAt: Date.now(), size: blob.size, mimeType: blob.type }, ...list].slice(0, 10),
      );
      const viewing = getViewingPatternData();
      const pid = viewing?.id;
      if (pid) {
        setPatternRecordings((prev) => {
          const curr = prev[pid] || [];
          const next = [{ url, createdAt: Date.now(), size: blob.size, mimeType: blob.type }, ...curr].slice(0, 10);
          return { ...prev, [pid]: next };
        });
      }
      logger('[repl] ⏹ recording saved');
    } catch (e) {
      setRecording(false);
      logger('[repl] failed to stop recording', 'error');
    }
  };
  const handleDownloadRecording = () => {
    if (!lastRecordingUrl) return;
    const a = document.createElement('a');
    a.href = lastRecordingUrl;
    a.download = 'strudel-recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const handleDownloadFromList = (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strudel-recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const handlePersistRecording = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const now = new Date();
      const title = `recording-${now.toISOString().replace(/[:.]/g, '-')}.webm`;
      const id = `recordings/${title}`;
      await saveSampleBlobToDB(title, blob, id);
      logger('[repl] 💾 recording saved to samples DB', 'success');
    } catch (e) {
      logger('[repl] failed to persist recording', 'error');
      console.error(e);
    }
  };
  const handleDeleteRecording = (patternId, url) => {
    setRecordings((list) => list.filter((r) => r.url !== url));
    if (patternId) {
      setPatternRecordings((prev) => {
        const curr = prev[patternId] || [];
        return { ...prev, [patternId]: curr.filter((r) => r.url !== url) };
      });
    }
    try {
      URL.revokeObjectURL(url);
    } catch {}
  };
  const context = {
    started,
    pending,
    isDirty,
    activeCode,
    handleTogglePlay,
    handleUpdate,
    handleShuffle,
    handleShare,
    handleArmRecordOnNextPlay,
    handleStopAndSaveRecording,
    handleDownloadRecording,
    recording,
    recordings,
    patternRecordings,
    handleDownloadFromList,
    handlePersistRecording,
    handleDeleteRecording,
    handleEvaluate,
    init,
    error,
    editorRef,
    containerRef,
  };
  return context;
}
