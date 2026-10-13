# OnCall Desk 📞

> Real-time calling workstation built with React, Node.js, WebRTC, Anthropic Claude, and PSTN Telephony Gateway.

## Overview
OnCall Desk delivers three calling modes in a single workspace:
1. **Peer-to-Peer Calls**: Real two-way browser audio over WebRTC with Socket.IO signaling.
2. **AI Voice Operator ("Aria")**: Real-time voice conversation powered by Anthropic Claude and Speech APIs.
3. **PSTN Telephony**: Web-to-real-phone dialing connecting browser sessions to genuine carrier phone numbers.

## Architecture
- **Frontend**: React + Vite + Lucide Icons + Web Audio API
- **Backend**: Node.js + Express + Socket.IO
- **Signaling & Audio**: WebRTC + Socket.IO
- **AI Voice Agent**: Anthropic Claude API + Web Speech Recognition / Synthesis
- **Telephony**: SIP / PSTN Gateway (Twilio Voice)

## Getting Started

### Prerequisites
- Node.js >= 18
- npm >= 9

### Installation
```bash
# Clone the repository
git clone https://github.com/roxxerdk/oncall-desk.git
cd oncall-desk

# Setup Frontend
cd frontend
npm install
npm run dev

# Setup Backend
cd ../backend
npm install
npm run dev
```

## License
MIT
