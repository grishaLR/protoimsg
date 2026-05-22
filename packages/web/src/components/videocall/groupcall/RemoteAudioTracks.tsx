import { useTracks, AudioTrack, type TrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';

/** Renders a hidden <audio> element for every remote participant's microphone. */
export function RemoteAudioTracks() {
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  const remote = audioTracks.filter(
    (t): t is TrackReference => !t.participant.isLocal && !!t.publication?.track,
  );
  return (
    <>
      {remote.map((t) => (
        <AudioTrack key={t.participant.sid + '-audio'} trackRef={t} />
      ))}
    </>
  );
}
