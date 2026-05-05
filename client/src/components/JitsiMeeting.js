import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const JitsiMeeting = ({ sessionId, tutorName, learnerName, onSessionEnded }) => {
  const jitsiContainerRef = useRef(null);
  const jitsiApiRef = useRef(null);
  const sessionCompletedRef = useRef(false);
  const onSessionEndedRef = useRef(onSessionEnded);
  const containerDivRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [meetingLink, setMeetingLink] = useState('');

  useEffect(() => {
    onSessionEndedRef.current = onSessionEnded;
  }, [onSessionEnded]);

  useEffect(() => {
    sessionCompletedRef.current = false;

    const initializeMeeting = () => {
      if (!window.JitsiMeetExternalAPI || !jitsiContainerRef.current) {
        return;
      }

      if (jitsiApiRef.current) {
        try {
          jitsiApiRef.current.dispose();
        } catch (error) {
          console.error('Error disposing previous Jitsi instance:', error);
        }
        jitsiApiRef.current = null;
      }

      jitsiContainerRef.current.innerHTML = '';

      // Build Jitsi meeting link for sharing
      const jitsiRoomName = `peer-${sessionId}`;
      const jitsiLink = `https://meet.jit.si/${jitsiRoomName}`;
      setMeetingLink(jitsiLink);

      const options = {
        roomName: jitsiRoomName,
        parentNode: jitsiContainerRef.current,
        configOverwrite: {
          disableSimulcast: false,
          prejoinPageEnabled: false,
          disableDeepLinking: true
        },
        interfaceConfigOverwrite: {
          DEFAULT_BACKGROUND: '#000000',
          HIDE_INVITE_MORE_HEADER: true
        },
        userInfo: {
          displayName: tutorName || learnerName || 'Peer User'
        }
      };

      try {
        const api = new window.JitsiMeetExternalAPI('meet.jit.si', options);
        jitsiApiRef.current = api;

        api.addEventListener('videoConferenceLeft', async () => {
          console.log('✅ JitsiMeeting: Conference ended');

          if (sessionCompletedRef.current) {
            return;
          }
          sessionCompletedRef.current = true;

          try {
            await axios.put(`/request/${sessionId}/complete`);
            console.log('✅ JitsiMeeting: Session marked as complete on server');

            if (onSessionEndedRef.current) {
              onSessionEndedRef.current();
            }
          } catch (error) {
            console.error('❌ JitsiMeeting: Error completing session:', error);
          }
        });

        // Add fullscreen capability
        api.addEventListener('fullScreenToggled', (e) => {
          setIsFullscreen(e.isFullScreen);
        });
      } catch (error) {
        console.error('❌ JitsiMeeting: Error initializing Jitsi:', error);
      }
    };

    if (window.JitsiMeetExternalAPI) {
      initializeMeeting();
    } else {
      const existingScript = document.querySelector('script[src="https://meet.jit.si/external_api.js"]');
      if (existingScript) {
        existingScript.addEventListener('load', initializeMeeting, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://meet.jit.si/external_api.js';
        script.async = true;
        script.addEventListener('load', initializeMeeting, { once: true });
        document.head.appendChild(script);
      }
    }

    return () => {
      // Cleanup
      if (jitsiApiRef.current) {
        try {
          jitsiApiRef.current.dispose();
        } catch (error) {
          console.error('Error disposing Jitsi API:', error);
        }
        jitsiApiRef.current = null;
      }
    };
  }, [sessionId, learnerName, tutorName]);

  // Handle fullscreen toggle via Jitsi API
  const toggleFullscreen = () => {
    if (jitsiApiRef.current) {
      try {
        if (isFullscreen) {
          document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        } else {
          containerDivRef.current?.requestFullscreen?.() || 
          containerDivRef.current?.webkitRequestFullscreen?.();
        }
        setIsFullscreen(!isFullscreen);
      } catch (error) {
        console.error('Error toggling fullscreen:', error);
      }
    }
  };

  // Copy meeting link to clipboard
  const copyLinkToClipboard = () => {
    if (meetingLink) {
      navigator.clipboard.writeText(meetingLink);
      alert('📋 Meeting link copied to clipboard!');
    }
  };

  return (
    <div 
      ref={containerDivRef}
      style={{
        width: isFullscreen ? '100vw' : '100%',
        height: isFullscreen ? '100vh' : '600px',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 9999 : 'auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#000'
      }}
    >
      {/* Control Panel */}
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        borderBottom: '2px solid #007bff'
      }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <p style={{ color: '#fff', margin: '0 0 6px 0', fontSize: '12px', fontWeight: 'bold' }}>
            🔗 Meeting Link:
          </p>
          <div style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }}>
            <input
              type="text"
              readOnly
              value={meetingLink}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: '4px',
                border: '1px solid #007bff',
                backgroundColor: '#fff',
                color: '#333',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}
            />
            <button
              onClick={copyLinkToClipboard}
              style={{
                padding: '6px 12px',
                backgroundColor: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                transition: 'background 0.3s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#0056b3'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#007bff'}
            >
              📋 Copy Link
            </button>
          </div>
        </div>

        <button
          onClick={toggleFullscreen}
          style={{
            padding: '8px 16px',
            backgroundColor: isFullscreen ? '#ff6b6b' : '#28a745',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            transition: 'background 0.3s',
            whiteSpace: 'nowrap'
          }}
          onMouseOver={(e) => e.target.style.backgroundColor = isFullscreen ? '#cc5555' : '#218838'}
          onMouseOut={(e) => e.target.style.backgroundColor = isFullscreen ? '#ff6b6b' : '#28a745'}
        >
          {isFullscreen ? '⛶ Exit Fullscreen' : '⛶ Fullscreen'}
        </button>
      </div>

      {/* Jitsi Meeting Container */}
      <div
        ref={jitsiContainerRef}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: isFullscreen ? 'none' : '2px solid #007bff',
          borderRadius: isFullscreen ? '0' : '8px',
          overflow: 'hidden',
        }}
      />
    </div>
  );
};

export default JitsiMeeting;
