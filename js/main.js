"use strict";
  const video1 = document.querySelector("video#video1");
  const video2 = document.querySelector("video#video2");
  const videoMonitor = document.querySelector("#video-monitor");

  const startButton = document.querySelector("button#start");
  const callButton = document.querySelector("button#call");
  const hangupButton = document.querySelector("button#hangup");

  const banner = document.querySelector("#banner");
  const muteMiddleBox = document.querySelector("#mute-middlebox");
  const senderWaveForm = document.querySelector('#senderWaveForm');
  const receiverWaveForm = document.querySelector('#receiverWaveForm');
  const monitorWaveForm = document.querySelector('#monitorWaveForm');
  
  let senderWaveInstance;
  let receiverWaveInstance;
  let monitorWaveInstance;

  startButton.onclick = start;
  callButton.onclick = call;
  hangupButton.onclick = hangup;

  muteMiddleBox.addEventListener("change", toggleMute);

  let startToMiddle;
  let startToEnd;

  const frameTypeToCryptoOffset = {
    key: 10,
    delta: 3,
    undefined: 1,
  };

  // let key = 'ec75109d-bfe2-48';
  // let iv = "KCap6JeLif31Q9xs";
  let localStream;
  let remoteStream;
  let monitorStream;

  let useCryptoOffset = true;

  function gotStream(stream) {
    console.log("Received local stream");
    if(senderWaveInstance) senderWaveInstance.destroyWaveSurfer();

    senderWaveInstance = new instanceWaveSurfer("#senderWaveForm");
    senderWaveInstance.createWaveSurfer(stream);

    video1.srcObject = stream;
    localStream = stream;
    callButton.disabled = false;
  }

  function gotRemoteStream(stream) {
    console.log("Received remote stream");
    remoteStream = stream;
    video2.srcObject = stream;
  }

  function start() {
    console.log("Requesting local stream");
    startButton.disabled = true;
    const options = { audio: true, video: true };
    navigator.mediaDevices
      .getUserMedia(options)
      .then(gotStream)
      .catch(function (e) {
        alert("getUserMedia() failed");
        console.log("getUserMedia() error: ", e);
      });
  }

  function base64ToArrayBuffer(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  const encryptAES = Module.cwrap("encryptAES","string",["string"]);
  const decryptAES = Module.cwrap("decryptAES","string",["string"]);

  async function encodeFunction(encodedFrame, controller) {
      const view = new DataView(encodedFrame.data);

      // Tr?????c khi m?? ho?? th?? c???t ra c??i offset th??ng b??o media type ????, ??o???n n??y kh??ng ???????c m?? ho??, kh??ng l???i m???t :3
      const cryptoOffset = useCryptoOffset
        ? frameTypeToCryptoOffset[encodedFrame.type]
        : 0;

      const bufferAfterCutOffset = encodedFrame.data.slice(cryptoOffset);
      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(bufferAfterCutOffset))
      );

      // const base64String = "hahhahaahahaha";

      // M?? ho?? AES CBC
      // const encryptedData = CryptoJS.AES.encrypt(base64String, key, {
      //   iv: CryptoJS.enc.Utf8.parse(iv),
      //   mode: CryptoJS.mode.CBC,
      //   padding: CryptoJS.pad.Pkcs7,
      // });
      const encryptedData = encryptAES(base64String);
    // if(base64String == decryptedData) console.log(true);
      // const encryptedData = CryptoJS.AES.encrypt(
      //   base64String,
      //   currentCryptoKey
      // );

      const encryptedArrayBuffer = base64ToArrayBuffer(encryptedData);

      const encryptView = new DataView(encryptedArrayBuffer);

      const newData = new ArrayBuffer(
        encryptedArrayBuffer.byteLength + cryptoOffset
      );

      const newView = new DataView(newData);

      // Th??m cryptoOffset
      for (let i = 0; i < cryptoOffset; ++i) {
        newView.setInt8(i, view.getInt8(i));
      }

      // Th??m encrypt data
      for (let i = 0; i < encryptedArrayBuffer.byteLength; ++i) {
        newView.setInt8(i + cryptoOffset, encryptView.getInt8(i));
      encodedFrame.data = newData;
    }
    controller.enqueue(encodedFrame);
  }

  async function decodeFunction(encodedFrame, controller) {
      const view = new DataView(encodedFrame.data);
      const cryptoOffset = useCryptoOffset
        ? frameTypeToCryptoOffset[encodedFrame.type]
        : 0;

      // 1. Gi???i m?? ph???n data b??? m?? ho??

      const bufferAfterCutOffset = encodedFrame.data.slice(cryptoOffset);

      const base64String = btoa(
        String.fromCharCode(...new Uint8Array(bufferAfterCutOffset))
      );

      // const decryptedData = CryptoJS.AES.decrypt(
      //   base64String,
      //   currentCryptoKey
      // ).toString(CryptoJS.enc.Utf8);

      // const decryptedData = CryptoJS.AES.decrypt(base64String, key, {
      //   iv: CryptoJS.enc.Utf8.parse(iv),
      //   mode: CryptoJS.mode.CBC,
      //   padding: CryptoJS.pad.Pkcs7,
      // }).toString(CryptoJS.enc.Utf8);

      const decryptedData = decryptAES(base64String);
      const decryptedArrayBuffer = base64ToArrayBuffer(decryptedData);

      const decryptView = new DataView(decryptedArrayBuffer);

      const newData = new ArrayBuffer(
        decryptedArrayBuffer.byteLength + cryptoOffset
      );
      const newView = new DataView(newData);

      // Th??m offset v??o
      for (let i = 0; i < cryptoOffset; ++i) {
        newView.setInt8(i, view.getInt8(i));
      }

      // Th??m ph???n data ???? gi???i m?? v??o
      for (let i = 0; i < decryptedArrayBuffer.byteLength; ++i) {
        newView.setInt8(i + cryptoOffset, decryptView.getInt8(i));
      }

      encodedFrame.data = newData;
    controller.enqueue(encodedFrame);
  }

  function setupSenderTransform(sender) {
    const senderStreams = sender.createEncodedStreams();
    const transformStream = new TransformStream({
      transform: encodeFunction,
    });
    senderStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(senderStreams.writable);
  }

  function setupReceiverTransform(receiver) {
    const receiverStreams = receiver.createEncodedStreams();
    const transformStream = new TransformStream({
      transform: decodeFunction,
    });
    receiverStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(receiverStreams.writable);
  }

  function call() {
    callButton.disabled = true;
    hangupButton.disabled = false;
    video1.muted = true;

    console.log("Starting call");
    startToMiddle = new VideoPipe(localStream, true, false, (e) => {
      videoMonitor.srcObject = e.streams[0];
      if(!videoMonitor.muted) {
        destroyAllWaveForm();

        monitorWaveInstance = new instanceWaveSurfer("#monitorWaveForm");
        monitorWaveInstance.createWaveSurfer(e.streams[0]);
      } else {
        monitorStream = e.streams[0];
      }
    });
    startToMiddle.pc1.getSenders().forEach(setupSenderTransform);
    startToMiddle.negotiate();

    startToEnd = new VideoPipe(localStream, true, true, (e) => {
      setupReceiverTransform(e.receiver);
      gotRemoteStream(e.streams[0]);
      destroyAllWaveForm();

      receiverWaveInstance = new instanceWaveSurfer("#receiverWaveForm");
      receiverWaveInstance.createWaveSurfer(e.streams[0]);
    });
    startToEnd.pc1.getSenders().forEach(setupSenderTransform);
    startToEnd.negotiate();

    console.log("Video pipes created");
  }

  function hangup() {
    video1.muted = false;
    console.log("Ending call");
    startToMiddle.close();
    startToEnd.close();
    hangupButton.disabled = true;
    callButton.disabled = false;
    destroyAllWaveForm();
  }

  function toggleMute(event) {
    video2.muted = muteMiddleBox.checked;
    videoMonitor.muted = !muteMiddleBox.checked;
    if(muteMiddleBox.checked && callButton.disabled) {
      destroyAllWaveForm();

      monitorWaveInstance = new instanceWaveSurfer("#monitorWaveForm");
      monitorWaveInstance.createWaveSurfer(monitorStream);
    } else {
      destroyAllWaveForm();
      receiverWaveInstance = new instanceWaveSurfer("#receiverWaveForm");
      receiverWaveInstance.createWaveSurfer(remoteStream);
    }
  }

  const destroyAllWaveForm = () => {
    if(monitorWaveInstance) monitorWaveInstance.destroyWaveSurfer();
    if(receiverWaveInstance) receiverWaveInstance.destroyWaveSurfer();
  }