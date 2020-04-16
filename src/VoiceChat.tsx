import * as React from "react";
import { useRef, useState, useEffect, useContext } from "react";

import css from "./VoiceChat.module.css";
import { UserMe, UsersRemoteList, EmptyRoom } from "./Components";
import { useStore, User, TransportEvent, StoreProvider } from "./api";

function sample<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

const createAudioContext = (): AudioContext => {
  window.AudioContext =
    window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContext();
  return audioContext;
};
const AudioContextContext = React.createContext<AudioContext | undefined>(
  undefined
);
export const AudioContextProvider: React.FC = ({ children }) => {
  const refAudioContext = useRef<AudioContext>();
  if (!refAudioContext.current) {
    refAudioContext.current = createAudioContext();
  }
  return (
    <AudioContextContext.Provider value={refAudioContext.current}>
      {children}
    </AudioContextContext.Provider>
  );
};
export const useAudioContext = (): AudioContext => {
  const audioContext = useContext(AudioContextContext);
  if (!audioContext) {
    throw new Error("AudioContext is not initialized");
  }
  return audioContext; // audio context is always defined, but may be in suspended state
};

class MediaStreamManager {
  public audioContext: AudioContext;
  public gainMaster: GainNode;

  private mediaStreamDestination: MediaStreamAudioDestinationNode;

  private microphone: MediaStreamAudioSourceNode | undefined;
  private microphoneGain: GainNode | undefined;

  // private oscillator: OscillatorNode;
  // private oscillatorGain: GainNode;

  public isMicrophoneRequested: boolean;

  constructor(audioContext: AudioContext) {
    this.isMicrophoneRequested = false;
    this.audioContext = audioContext;

    // this.oscillator = this.audioContext.createOscillator();
    // this.oscillatorGain = this.audioContext.createGain();
    // this.disableOscillator();

    this.gainMaster = this.audioContext.createGain();

    // this.oscillator.connect(this.oscillatorGain);
    // this.oscillatorGain.connect(this.gainMaster);

    // this.oscillator.detune.value = 100;
    // this.oscillator.frequency.value = sample([
    //   200,
    //   250,
    //   300,
    //   350,
    //   400,
    //   450,
    //   500,
    //   550,
    // ]);

    // this.oscillator.start(0);

    this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
    this.gainMaster.connect(this.mediaStreamDestination);

    this.gainMaster.gain.value = 1;
  }

  public getStream(): MediaStream {
    return this.mediaStreamDestination.stream;
  }

  public async requestMicrophone(): Promise<void> {
    try {
      this.isMicrophoneRequested = true;
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      this.microphone = this.audioContext.createMediaStreamSource(mediaStream);
      this.microphoneGain = this.audioContext.createGain();
      this.microphoneGain.gain.value = 0; // mute by default
      this.microphone.connect(this.microphoneGain);
      this.microphoneGain.connect(this.gainMaster);
    } catch (error) {
      this.isMicrophoneRequested = false;
      return undefined;
    }
  }

  mute() {
    this.gainMaster.gain.value = 0;
  }
  unmute() {
    this.gainMaster.gain.value = 1;
  }

  get isMicrophoneMuted(): boolean {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    return this.microphoneGain.gain.value === 0;
  }

  microphoneMute(): void {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    this.microphoneGain.gain.value = 0;
  }
  microphoneUnmute(): void {
    if (!this.microphoneGain) {
      throw new Error("Microphone is not connected");
    }
    this.microphoneGain.gain.value = 1;
  }

  enableOscillator() {
    // this.oscillatorGain.gain.value = 1;
  }
  disableOscillator() {
    // this.oscillatorGain.gain.value = 0;
  }
}

interface Transport {
  sendOffer: (sessionDescription: RTCSessionDescriptionInit) => void;
  sendAnswer: (sessionDescription: RTCSessionDescriptionInit) => void;
  sendCandidate: (candidate: RTCIceCandidateInit) => void;
  sendEvent: (event: TransportEvent) => void;

  onOpen: (callback: () => void) => void;
  onOffer: (
    callback: (sessionDescription: RTCSessionDescriptionInit) => void
  ) => void;
  onAnswer: (
    callback: (sessionDescription: RTCSessionDescriptionInit) => void
  ) => void;
  onCandidate: (callback: (candidate: RTCIceCandidateInit) => void) => void;
}

class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private onOfferCallback: (
    sessionDescription: RTCSessionDescriptionInit
  ) => void;
  private onAnswerCallback: (
    sessionDescription: RTCSessionDescriptionInit
  ) => void;
  private onCandidateCallback: (candidate: RTCIceCandidateInit) => void;
  private onOpenCallback: () => void;
  private onEventCallback: (event: TransportEvent) => void;
  constructor(path: string) {
    this.onOfferCallback = () => undefined;
    this.onAnswerCallback = () => undefined;
    this.onCandidateCallback = () => undefined;
    this.onOpenCallback = () => undefined;
    this.onEventCallback = () => undefined;
    this.ws = new WebSocket(path);
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("open", () => this.onOpenCallback());
    this.ws.addEventListener("close", () => console.log("ws is closed"));
    this.ws.addEventListener("error", (error) => console.error(error));
  }
  public sendOffer(sessionDescription: RTCSessionDescriptionInit): void {
    this.sendEvent({ type: "offer", offer: sessionDescription });
  }
  public sendAnswer(sessionDescription: RTCSessionDescriptionInit): void {
    this.sendEvent({ type: "answer", answer: sessionDescription });
  }
  public sendCandidate(candidate: RTCIceCandidateInit) {
    this.sendEvent({ type: "candidate", candidate });
  }
  public requestOffer() {
    this.sendEvent({ type: "request_offer" });
  }
  public sendEvent(event: TransportEvent) {
    this.ws.send(JSON.stringify(event));
  }

  private onMessage(event: MessageEvent) {
    const data = JSON.parse(event.data) as TransportEvent;

    if (data.type === "answer" && data.answer) {
      return this.onAnswerCallback(data.answer);
    } else if (data.type === "offer" && data.offer) {
      return this.onOfferCallback(data.offer);
    } else if (data.type === "candidate" && data.candidate) {
      return this.onCandidateCallback(data.candidate);
    } else if (data.type === "error") {
      console.error(data);
    } else {
      this.onEventCallback(data);
    }
  }

  public onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }
  public onOffer(callback: WebSocketTransport["onOfferCallback"]): void {
    this.onOfferCallback = callback;
  }
  public onAnswer(callback: WebSocketTransport["onAnswerCallback"]): void {
    this.onAnswerCallback = callback;
  }
  public onCandidate(
    callback: WebSocketTransport["onCandidateCallback"]
  ): void {
    this.onCandidateCallback = callback;
  }
  public onEvent(callback: WebSocketTransport["onEventCallback"]): void {
    this.onEventCallback = callback;
  }
}

const usePeerConnection = ({
  transport,
}: {
  transport: Transport;
}): RTCPeerConnection => {
  const refPeerConnection = useRef<RTCPeerConnection>(
    new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    })
  );
  const peerConnection = refPeerConnection.current;
  const { current: state } = useRef<{
    isSendingOffer: boolean;
  }>({
    isSendingOffer: false,
  });

  useEffect(() => {
    const handleTrack = async (event: RTCTrackEvent) => {
      console.log(event);
      console.log(`peerConnection::ontrack ${event.track.kind}`);
      console.log(event.track.kind, event.streams);
      const stream = event.streams[0];
      try {
        // if (refAudioEl.current) {
        //   refAudioEl.current.srcObject = stream;
        //   refAudioEl.current.autoplay = true;
        //   refAudioEl.current.controls = true;
        //   await refAudioEl.current.play();
        // }
        const audioEl = document.createElement("audio");
        console.log("attached speaker volume");
        audioEl.srcObject = stream;
        audioEl.autoplay = true;
        audioEl.controls = true;
        document.querySelector("#tracks")?.appendChild(audioEl);
        await audioEl.play();
      } catch (error) {
        console.log(error);
      }
    };
    const handleConnectionStateChange = (event: Event) => {
      console.log(
        `peerConnection::onIceConnectionStateChange ${peerConnection.iceConnectionState}`
      );
    };
    const handleICECandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        transport.sendCandidate(event.candidate.toJSON());
      }
    };

    const handleNegotiationNeeded = async (event: Event) => {
      // console.log("peerConnection::negotiationneeded", event);
      // await peerConnection.setLocalDescription(
      //   await peerConnection.createOffer()
      // );
      // if (!peerConnection.localDescription) {
      //   throw new Error("no local description");
      // }
      // transport.sendOffer(peerConnection.localDescription);
    };

    peerConnection.addEventListener("track", handleTrack);
    peerConnection.addEventListener(
      "iceconnectionstatechange",
      handleConnectionStateChange
    );

    peerConnection.addEventListener(
      "negotiationneeded",
      handleNegotiationNeeded
    );
    peerConnection.addEventListener("icecandidate", handleICECandidate);

    return () => {
      peerConnection.removeEventListener("track", handleTrack);
      peerConnection.removeEventListener(
        "connectionstatechange",
        handleConnectionStateChange
      );
      peerConnection.removeEventListener("icecandidate", handleICECandidate);
      peerConnection.removeEventListener(
        "negotiationneeded",
        handleNegotiationNeeded
      );
    };
  }, []);

  return refPeerConnection.current;
};

export const Conference = () => {
  // const [micEnabled, setMicEnabled] = useState<boolean>(DEFAULT_MIC_ENABLED);
  // const [microphoneVolume, setMicrophoneVolume] = useState<number>(0);
  // const [speakerVolume, setSpeakerVolume] = useState<number>(0);
  const audioContext = useAudioContext();
  const refMediaStreamManager = useRef<MediaStreamManager>();
  if (!refMediaStreamManager.current) {
    refMediaStreamManager.current = new MediaStreamManager(audioContext);
  }
  // const refAudioElBach = useRef<HTMLMediaElement | null>(null);
  const store = useStore();
  const { state, update } = store;

  const [user, setUser] = useState<User>();
  const refTransport = useRef<WebSocketTransport>();
  if (!refTransport.current) {
    refTransport.current = new WebSocketTransport(
      `wss://cap.chat/${window.location.pathname.replace("/", "")}`
    );
  }
  const transport = refTransport.current;
  const peerConnection = usePeerConnection({ transport });

  const log = (msg: any) => {
    console.log(msg);
  };

  const subscribe = async () => {
    try {
      if (!refMediaStreamManager.current) {
        throw new Error("no media stream manager");
      }
      const mediaStream = refMediaStreamManager.current.getStream();
      const audioTracks = mediaStream.getAudioTracks();
      for (const track of audioTracks) {
        peerConnection.addTrack(track, mediaStream);
      }
    } catch (error) {
      log(error);
    }
  };

  useEffect(() => {
    console.log("store", store);
    transport.onOpen(() => {
      console.log("web socket connection is open");
      subscribe();
      transport.requestOffer();
    });
    transport.onOffer(async (offer) => {
      await peerConnection.setRemoteDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      transport.sendAnswer(answer);
    });
    transport.onAnswer(async (answer) => {
      await peerConnection.setRemoteDescription(answer);
    });
    transport.onCandidate(async (candidate) => {
      console.log("[local]: adding ice candidate");
      await peerConnection.addIceCandidate(candidate);
    });
    transport.onEvent(async (event) => {
      console.log("EVENT", event);

      if (event.type === "user_join") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserAdd(event.user);
      } else if (event.type === "user_leave") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserRemove(event.user);
      } else if (event.type === "user") {
        setUser(event.user);
      } else if (event.type === "room") {
        store.update({ room: event.room });
      } else if (event.type === "mute") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserUpdate(event.user);
      } else if (event.type === "unmute") {
        if (!event.user) {
          throw new Error("no user");
        }
        store.api.roomUserUpdate(event.user);
      } else {
        throw new Error(`type ${event.type} not implemented`);
      }
    });
  }, [store]);

  const renderUsers = () => {
    if (state.room.users.length === 0) {
      return <EmptyRoom />;
    }
    return <UsersRemoteList users={store.state.room.users} />;
  };

  const [showConference, setShowConference] = useState<boolean>(false);

  if (!showConference) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          onClick={async () => {
            if (audioContext.state === "suspended") {
              console.log("audio context was in suspended state. resuming...");
              await audioContext.resume();
            }
            setShowConference(true);
          }}
          className={css.buttonJoin}
        >
          войти 📞
        </button>
      </div>
    );
  }
  return (
    <div className={css.wrapper}>
      <div className={css.top}>{renderUsers()}</div>
      <div className={css.bottom}>
        {user && (
          <UserMe
            user={user}
            isMutedMicrophone={state.isMutedMicrophone}
            isMutedSpeaker={state.isMutedSpeaker}
            onClickMuteSpeaker={() => {
              try {
                update({ isMutedSpeaker: !state.isMutedSpeaker });
              } catch (error) {
                alert(error);
              }
            }}
            onClickMuteMicrohone={async (event) => {
              if (refMediaStreamManager.current) {
                if (!refMediaStreamManager.current.isMicrophoneRequested) {
                  await refMediaStreamManager.current.requestMicrophone();
                }
                if (refMediaStreamManager.current.isMicrophoneMuted) {
                  refMediaStreamManager.current.microphoneUnmute();
                  transport.sendEvent({ type: "unmute", user });
                  update({ isMutedMicrophone: false });
                } else {
                  refMediaStreamManager.current.microphoneMute();
                  transport.sendEvent({ type: "mute", user });
                  update({ isMutedMicrophone: true });
                }
              }
            }}
          />
        )}
      </div>
    </div>
  );
};

export const VoiceChat = () => {
  const refContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const set100vh = () => {
      if (refContainer.current) {
        refContainer.current.style.height = `${window.innerHeight}px`;
      }
    };
    window.addEventListener("resize", set100vh);
    set100vh();
    return () => {
      window.removeEventListener("resize", set100vh);
    };
  }, []);
  return (
    <AudioContextProvider>
      <StoreProvider>
        <div className={css.container} ref={refContainer}>
          <ErrorBoundary>
            <Conference />
          </ErrorBoundary>
        </div>
      </StoreProvider>
    </AudioContextProvider>
  );
};

const Trash = () => {
  // useEffect(() => {
  //   const handleUnmuteMicrophone = (event: KeyboardEvent) => {
  //     try {
  //       if (event.key === "Shift") {
  //         if (refMediaStreamManager.current) {
  //           refMediaStreamManager.current.microphoneUnmute();
  //           setMicEnabled(true);
  //         }
  //       }
  //     } catch (error) {
  //       log(error);
  //     }
  //   };
  //   const handleMuteMicrophone = (event: KeyboardEvent) => {
  //     try {
  //       if (event.key === "Shift") {
  //         if (refMediaStreamManager.current) {
  //           refMediaStreamManager.current.microphoneUnmute();
  //           setMicEnabled(false);
  //         }
  //       }
  //     } catch (error) {
  //       log(error);
  //     }
  //   };
  //   window.addEventListener("keydown", handleUnmuteMicrophone);
  //   window.addEventListener("keyup", handleMuteMicrophone);
  //   return () => {
  //     window.removeEventListener("keydown", handleUnmuteMicrophone);
  //     window.removeEventListener("keyup", handleMuteMicrophone);
  //   };
  // }, []);
  return (
    <div>
      {/* <div>
        <button
          onClick={() => {
            console.log("streaming bach");
            if (refAudioElBach.current && refMediaStreamManager.current) {
              const mediaElementSource = refMediaStreamManager.current.audioContext.createMediaElementSource(
                refAudioElBach.current
              );
              const gainMedia = refMediaStreamManager.current.audioContext.createGain();
              mediaElementSource.connect(gainMedia);
              gainMedia.gain.value = 0.05;
              gainMedia.connect(refMediaStreamManager.current.gainMaster);
              refAudioElBach.current.play();
            }
          }}
        >
          stream j.s bach
        </button>
      </div> */}
      {/* <div>
        <button
          onClick={async () => {
            console.log("adding track");
            // if (refMediaStreamManager.current) {
            // const stream = refMediaStreamManager.current.getStream()
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: true
            });
            peerConnection.addTrack(stream.getAudioTracks()[0], stream);
            // }
          }}
        >
          add track dynamically
        </button>
      </div> */}
      {/* <audio
        ref={refAudioElBach}
        controls
        src="https://www.thesoundarchive.com/starwars/star-wars-cantina-song.mp3"
      /> */}
      {/* <div>
        <button onClick={() => {}}>
          {micEnabled ? "mute" : "enable"} microphone
          <span role="img" aria-label="enable microphone">
            🎤
          </span>
        </button>
      </div>
      <div>microphone: {micEnabled ? "enabled" : "disabled"}</div> */}
      {/* <div
          className={css.speakButton}
          onPointerDown={() => {
            // setMicEnabled(true);
            if (refMediaStreamManager.current) {
              // subscribe();
              refMediaStreamManager.current.enableOscillator();
            }
          }}
          onPointerUp={() => {
            // setMicEnabled(false);
            if (refMediaStreamManager.current) {
              refMediaStreamManager.current.disableOscillator();
            }
          }}
        /> */}
    </div>
  );
};

interface ErrorBoundaryProps {}
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  {
    errorMessage: string | undefined;
  }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { errorMessage: undefined };
  }
  static getDerivedStateFromError(error: Error) {
    // Update state so the next render will show the fallback UI.
    console.log("getDerivedStateFromError", error);
    return { errorMessage: error.toString() };
  }
  componentDidCatch(error: Error, info: any) {
    console.log("error here", error, info);
  }
  render() {
    if (this.state.errorMessage) {
      return <div>err: {this.state.errorMessage}</div>;
    }
    return this.props.children;
  }
}
