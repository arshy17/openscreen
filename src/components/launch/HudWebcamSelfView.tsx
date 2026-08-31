import { memo, useEffect, useRef } from "react";
import styles from "./LaunchWindow.module.css";

export const HudWebcamSelfView = memo(function HudWebcamSelfView({
	stream,
	recording,
	previewLabel,
	searchingLabel,
}: {
	stream: MediaStream | null;
	recording: boolean;
	previewLabel: string;
	searchingLabel: string;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.srcObject = stream;
		return () => {
			video.srcObject = null;
		};
	}, [stream]);

	return (
		<div
			data-testid="hud-webcam-self-view"
			data-recording={recording ? "true" : "false"}
			className={styles.hudWebcamSelfView}
			aria-label={previewLabel}
		>
			{stream ? (
				// No <track>: this is a live, muted self-view with nothing to caption.
				<video
					ref={videoRef}
					data-testid="hud-webcam-self-view-video"
					className={styles.hudWebcamSelfViewVideo}
					autoPlay
					muted
					playsInline
				/>
			) : (
				<span className={styles.hudWebcamSelfViewFallback}>{searchingLabel}</span>
			)}
			{recording ? <span className={styles.hudWebcamRecordingDot} aria-hidden="true" /> : null}
		</div>
	);
});
