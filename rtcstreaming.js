var RTCPeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
var IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;
navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var el = function( id ) { return document.getElementById( id ); }; 
var noop = function(){}; //Default callback
function RoomConnection(_fireref, _nick, _channel, _authId, roomcallback, listcallback, nickcallback) {
    var scope = this;
    var fireRef = null
    var nick = null;
    var haveNick = false;
    var authId = null;
    var channel = null;     
    var chanRef =  null;   
    var running = null;
    var roomList = null;
    var joinRooms = null;
    var hostingRoom = null;    //Holds reference to hosted room
    var stream = null;
    var casting = null;
    function roomInfo(roomName, roomRef, ishost, connected, pc, hostInfo, userList) {        //Data structure for room infos
        return {'roomName': roomName, 'roomRef': roomRef, 'ishost': ishost, 'connected': connected, 'pc': pc, 'hostInfo': hostInfo, 'userList': userList};
    };

    var ui = {
        setRoom: {add: noop, change: noop, remove: noop},
        setList: {add: noop, change: noop, remove: noop},
        setNick: {change: noop}
    }
    
    var iceConfig = {iceServers: [       
    {url:'stun:stun.l.google.com:19302'},
    {username: "gamefreak.jd@gmail.com", credential: "*", url: "turn:numb.viagenie.ca"}
  ]};
    init(_fireref, _nick, _channel, _authId, roomcallback, listcallback, nickcallback);   
    var roomCallbacks = { //namespace for room callbacks
        hostChanged : {
            'nick': function(s) {  //Use for both added and changed     
                var roomName = s.ref().parent().parent().name();
                if(joinRooms[roomName]) {            
                    joinRooms[roomName].hostInfo.nick = s.val();
                }
                ui.setRoom.change({name:roomName, hostname:s.val()});
            },
            'offer': function(s) {
                var roomName = s.ref().parent().parent().parent().name();
                if(s.val() == null) { //host removed offer, stream is down
                    if(joinRooms[roomName].connected == false) 
                        return;   
                    joinRooms[roomName].hostInfo.offer = null;
                    joinRooms[roomName].hostInfo.ice = null;
                    joinRooms[roomName].connected = false;
                    joinRooms[roomName].pc.close();
                    joinRooms[roomName].pc = new RTCPeerConnection(iceConfig, {"optional": []});
                    joinRooms[roomName].pc.onicecandidate = function(ice) {
                        if (ice.candidate == null) {return}
                        //if(ice.candidate.candidate.indexOf("typ host ") >= 0)
                        //   return;
                        if(joinRooms[roomName]) { //make sure we haven't left already
                            joinRooms[roomName].roomRef.child('users/'+authId+'/cliIce').set(JSON.stringify(ice.candidate))
                        }
                    };
                    joinRooms[roomName].roomRef.child('users/'+authId+'/answer').remove();
                    ui.setRoom.change({stream:null});
                    return;
                }
                if(joinRooms[roomName].connected == true) 
                    return;                      
                joinRooms[roomName].hostInfo.offer = new SessionDescription(JSON.parse(s.val()));       
                joinRooms[roomName].connected = true;
                joinRooms[roomName].pc.setRemoteDescription(joinRooms[roomName].hostInfo.offer);
                joinRooms[roomName].pc.onaddstream = function(e) {
                    ui.setRoom.change({name:roomName,stream:e.stream});
                    console.log(e.stream.getVideoTracks()[0]);
                }
                joinRooms[roomName].pc.createAnswer(function(answer) {
                    if(joinRooms[roomName]) { //Make sure we didn't leave already
                        joinRooms[roomName].pc.setLocalDescription(answer);
                        console.log('remotesetcli')
                        joinRooms[roomName].roomRef.child('users/'+authId+'/answer').set(JSON.stringify(answer));
                    }
                }, err, {});
            },                
            'hostIce': function(s) {
                if(s.val() == null) 
                    return;
                var roomName = s.ref().parent().parent().parent().name();
                joinRooms[roomName].hostInfo.ice = JSON.parse(s.val())              
                joinRooms[roomName].pc.addIceCandidate(new IceCandidate(joinRooms[roomName].hostInfo.ice))
                console.log('icesethost');
            }
        },            
        'userAdded': function(s) {
            var roomName = s.ref().parent().parent().name();
            room = joinRooms[roomName];
            var uAuth = s.name();
            var nick = s.child('nick').val();
            if(room.userList[uAuth]) {
                return
            }
            user = room.userList[uAuth] = {'nick':nick, 'ice':null, 'answer': null, 'connected':false, 'ref':s.ref()};        
            if(room.ishost && casting) {
                user.pc = new RTCPeerConnection(iceConfig, {"optional": []});
                user.pc.onicecandidate = function(ice) {
                    if (ice.candidate == null) 
                        return;
                   // if(ice.candidate.candidate.indexOf("typ host ") >= 0)
                    //    return;
                    s.ref().child("hostIce").set(JSON.stringify(ice.candidate))
                };          
                user.pc.addStream(stream);
                user.pc.createOffer(function(offer) {
                    user.pc.setLocalDescription(offer, function() {return});
                    s.ref().child("offer").set(JSON.stringify(offer))
                    
                },err,{"optional": [], "mandatory": {}});
                s.ref().child('answer').on('value', roomCallbacks.userChanged.answer);
                s.ref().child('cliIce').on('value', roomCallbacks.userChanged.cliIce);
            }
            s.ref().child('nick').on('value', roomCallbacks.userChanged.nick);                
            for(room in joinRooms) {
                troom = joinRooms[room];
                for(tuser in troom.userList) {
                    console.log('added ' + troom.userList[tuser].nick + ' ' + tuser);
                }
            }
            console.log(room.userList);
            console.log('test');
            ui.setRoom.change({name:roomName, userList:joinRooms[roomName].userList});
            return;
        },
        'userRemoved': function(s) {
            if(s.name() == authId)
                return;
            var roomName = s.ref().parent().parent().name();
            delete joinRooms[roomName].userList[s.name()];
            s.ref().child('nick').off();
            s.ref().child('answer').off();
            s.ref().child('cliIce').off();
            for(room in joinRooms) {
                troom = joinRooms[room];
                for(tuser in troom.userList) {
                    console.log(troom.userList[tuser].nick + ' ' + tuser);
                }
            }
            ui.setRoom.change({name:roomName, userList:joinRooms[roomName].userList});
        },                  
        'userChanged': {
            'nick': function(s) {
                var roomName = s.ref().parent().parent().parent().name();
                var uAuth = s.ref().parent().name()
                var nick = s.val()
                if(uAuth == authId) 
                    return;
                joinRooms[roomName].userList[uAuth].nick = nick;
                ui.setRoom.change({name:roomName, userList:joinRooms[roomName].userList});
                return;
            },
            'answer': function(s) {
                var roomName = s.ref().parent().parent().parent().name();
                var uAuth = s.ref().parent().name();
                if(joinRooms[roomName].userList[uAuth].connected == true)
                    return ;
                if(s.val() == null)
                    return
                joinRooms[roomName].userList[uAuth].answer = new SessionDescription(JSON.parse(s.val()))
                if(joinRooms[roomName].ishost) {
                    joinRooms[roomName].userList[uAuth].connected = true;
                    joinRooms[roomName].userList[uAuth].pc.setRemoteDescription(joinRooms[roomName].userList[uAuth].answer);
                    console.log('remotesethost');
                }
            },
            'cliIce': function(s) {
                var roomName = s.ref().parent().parent().parent().name();
                var uAuth = s.ref().parent().name();
                if(s.val() == null) {
                    return;
                }
                joinRooms[roomName].userList[uAuth].ice = JSON.parse(s.val())
                if(joinRooms[roomName].ishost) {
                    joinRooms[roomName].userList[uAuth].pc.addIceCandidate(new IceCandidate(joinRooms[roomName].userList[uAuth].ice))
                    console.log('icesethost');
                }
            }
        }     
    }
       
    this.joinRoom = function(room) {
        if(joinRooms[room]) {
            return;
        }
        chanRef.child(room+'/users/'+authId).set({nick: nick}, function(e) {
            if(e) {
                alert('Failed to join room'); 
                return;
            }
            var roomHost = chanRef.child(room+'/host');
            var roomUsers = chanRef.child(room+'/users');
            var newRoom = new roomInfo(room, chanRef.child(room), false, false, new RTCPeerConnection(iceConfig, {"optional": []}),{},{});
            joinRooms[room] = newRoom;            
            joinRooms[room].pc.onicecandidate = function(ice) {
                if (ice.candidate == null) {return}
                //if(ice.candidate.candidate.indexOf("typ host ") >= 0)
                 //   return;
                //if(ice.candidate.candidate.indexOf("typ srflx ") >= 0)
                 //   return;
                 
                if(joinRooms[room]) { //make sure we haven't left already
                    newRoom.roomRef.child('users/'+authId+'/cliIce').set(JSON.stringify(ice.candidate))
                    //newRoom.pc.onicecandidate = null;
                }
            };
            ui.setList.change(room, true);
            ui.setRoom.add({name:room, hostname:'',stream:null, connected:false, 'nick':nick, ishost:false, host:null, userList:{}});            
            roomHost.child('nick').on('value', roomCallbacks.hostChanged.nick);
            roomUsers.child(authId+'/offer').on('value', roomCallbacks.hostChanged.offer);
            roomUsers.child(authId+'/hostIce').on('value', roomCallbacks.hostChanged.hostIce);
            roomUsers.on('child_added', roomCallbacks.userAdded);
            roomUsers.on('child_removed', roomCallbacks.userRemoved);
            roomUsers.child(authId).onDisconnect().remove();

        });
    }   
     
    this.leaveRoom = function(room) {
        joinRooms[room].roomRef.child('host').off();
        joinRooms[room].roomRef.child('users/'+authId).remove();        
        joinRooms[room].roomRef.child('host/nick').off();
        joinRooms[room].roomRef.child('host/offer').off();
        joinRooms[room].roomRef.child('users/'+authId+'/hostIce').off();
        delete joinRooms[room];
        ui.setList.change(room, false);
        ui.setRoom.remove(room);
    }
    this.createRoom = function(room) {
        if(hostingRoom) {
            if(hostingRoom == room) {return};
            hostingRoom = false;
            userRef = joinRooms[hostingRoom].roomRef.child('users');
            userRef.off();
            delete joinRooms[hostingRoom];
        }
        roomRef = chanRef.child(room);
        hostingRoom = room;
        roomRef.child("host").set({'userid': authId, 'nick': nick}, function(e) {
            if(e) {
                alert('Failed to create room');
                hostingRoom = false;
                return
            }
            navigator.getUserMedia({video: true, audio: true}, function(s) {
                ui.setRoom.change({name:hostingRoom, stream:s});
                stream = s
                //video = document.getElementById("video")
               // video.src = URL.createObjectURL(stream);
                },err,{});
            var newRoom = new roomInfo(room, roomRef, true, false, null, {}, {});
            joinRooms[room] = newRoom;
            roomRef.child('users').on('child_added', roomCallbacks.userAdded);
            roomRef.child('users').on('child_removed', roomCallbacks.userRemoved);
            roomRef.onDisconnect().remove();
            ui.setRoom.add({name:room, hostname:nick, connected:false, ishost:true, stream:null,userList:{}});
        });
    }
    
    this.closeRoom = function(room) {
        if(hostingRoom) {        
            userRef = joinRooms[hostingRoom].roomRef.child('users');
            userRef.off();
            joinRooms[hostingRoom].roomRef.remove();
            delete joinRooms[hostingRoom];
            hostingRoom = false;
        }
    }
    
    this.startStream = function(rkey) {
        var room = joinRooms[rkey];      
        if(!hostingRoom || casting || !room.ishost)
            return;   
        casting = true;
        for(var ukey in room.userList) {
            var user = room.userList[ukey];
            if(user.pc) 
                this.endStream(room);   
            console.log(user);
            console.log(user.pc);
            console.log(user.ice);
            console.log(user.connected);
            user.pc = new RTCPeerConnection(iceConfig, {"optional":[]});
            user.pc.onicecandidate = function(ice) {
                if (ice.candidate == null) 
                    return;
               // if(ice.candidate.candidate.indexOf("typ host ") >= 0)
               //     return;
                user.ref.child("hostIce").set(JSON.stringify(ice.candidate))
            }; 
            user.pc.addStream(stream);
            user.pc.createOffer(function(offer) {
                user.pc.setLocalDescription(offer, function() {return});
                user.ref.child("offer").set(JSON.stringify(offer))
                    
            },err,{"optional": [], "mandatory": {}});
            user.ref.child('answer').on('value', roomCallbacks.userChanged.answer);
            user.ref.child('cliIce').on('value', roomCallbacks.userChanged.cliIce);            
        }
    }
    this.endStream = function(rkey) {
        var room = joinRooms[rkey];    
        if(!hostingRoom || !casting || !room.ishost)
            return;         
        casting = false;
        for(var ukey in room.userList) {
            var user = room.userList[ukey];
            user.pc.close();
            user.pc = null;
            user.ice = null;
            user.connected = false;
            user.ref.child("offer").remove();
            user.ref.child("hostIce").remove();
            user.ref.child("answer").off();
            user.ref.child("cliIce").off();
        }
    }
    
   
    this.setNick = function(nnick) {
        nickRef = fireRef.child('nicks/'+nnick);
        nickRef.set(authId, function(error) {
            if(error) {
                ui.setNick.change(authId);
            }
            else {
                if(haveNick) 
                    fireRef.child('nicks/'+nick).remove();
                if(hostingRoom) {
                    chanRef.child(hostingRoom+'/host/nick').set(nnick);
                    joinRooms[hostingRoom].hostInfo['nick'] = nnick;
                }
                for(var key in joinRooms) {
                    if(joinRooms[key].ishost) 
                        continue;
                    chanRef.child(joinRooms[key].roomName).child('users/'+authId+'/nick').set(nnick);
                }
                haveNick = true;
                nick = nnick;
                fireRef.child('nicks/'+nick).onDisconnect().remove();
                ui.setNick.change(nick);
            }
        });
    }
    
    this.getNick = function() {
        return nick;
    }
    function init(_fireref, _nick, _channel, _authId, roomcallback, listcallback, nickcallback) {
        fireRef = _fireref
        nick = _nick;
        haveNick = false;
        casting = false;
        authId = _authId;
        channel = _channel;     
        chanRef =  fireRef.child('channels/'+channel);   
        running = false;
        roomList = {};
        joinRooms = {};
        hostingRoom = false;
        ui.setList = listcallback;
        ui.setRoom = roomcallback;
        ui.setNick = nickcallback;
    }
    this.run = function() {
        if(running) {
            return;
        }
        running = true;
        if(!haveNick) {
            this.setNick(nick);
        }
        chanRef.on('child_added', function(s) {
            if(s.name() == hostingRoom) {
                return;
            }
            
            if(roomList[s.name()]) {
                return;
            }
            
            roomList[s.name()] = s;   
            if(ui.setList.add)
                ui.setList.add(s.name());
            return;
        });
    
        chanRef.on('child_removed', function(s) {
            if(roomList[s.name()]) {
                ui.setList.remove(s.name());
                delete roomList[s.name()];
            }
            
            if(joinRooms[s.name()]) {
                scope.leaveRoom(s.name());
                delete joinRooms[s.name()];
            }
            return;
        });
    
        chanRef.on('child_changed', function(s) {
            roomList[s.name()] = s;
            return;
        });      
    }
    
    this.reset = function(_fireref, _nick, _channel, _authId, roomcallback, listcallback, nickcallback) {
        this.closeRoom();
        if(haveNick) {
            if(_nick != nick) {
                fireRef.child('nicks/'+nick).remove();
                haveNick = false;
            }
        }
        for(var key in roomList) {
            ui.setList.remove(key);
        }
        for(var key in joinRooms) {
            this.leaveRoom(key);
        }
        delete joinRooms;
        delete roomList;
        chanRef.off();
        init(_fireref, _nick, _channel, _authId, roomcallback, listcallback, nickcallback);
    }     
    function err(e) {
        console.log(e);
    }
}    

var signaling = false;
var fireRef = null;
var nickInput = null;
var userid = null;
var auth = null;
var table = null;
var channel = null;
var casting = false;
var roominfo = {};
var setNick = {
    change: function(nick) {
        nickInput.value = nick;
    }
}

var joinedRooms = {
    add: function(_roominfo) { // {name:'roomname, hostname:'nick', connected:t/f, ishost:t/f, stream: null/stream, userList: {nick:'nick', connected:t/f}
        if(el(_roominfo.name + 'l'))
            return    
        roominfo[_roominfo.name] = _roominfo;
        roominfo[_roominfo.name].element = _roominfo.name + 'l';
        room = roominfo[_roominfo.name];
        var div = document.createElement('div');
        div.setAttribute("id", room.element);
        div.setAttribute("class", "vtile");
        div.innerHTML = '<span class="tile-host tile-over">' + room.hostname + '</span><span class="tile-name tile-over">' + room.name + '</span><div class="tileopt"><div class="tile-toggle tile-toggle-max"></div><div class="tile-leave"></div><div class="tile-mute tile-mute-off"></div></div><video class="tvideo" id="' + room.name + 'v" autoplay></video>'
        el('empty').style.display = 'none';
        el("videolist").insertBefore(div, el("videolist").firstChild);
        el(room.name + 'v').muted = true;
        if(room.stream) {
            el(room.name + 'v').src = URL.createObjectURL(room.stream);
        } else {
            $('#' + room.name + 'v').src = null;
        }
        el(room.element).querySelector(".tile-toggle").onclick = function() {
            room = roominfo[_roominfo.name];
            cclass = el(room.element).className;

            if(cclass == "vtile")  {
                $(".vtileb").css("height","150px");
                $(".vtileb").css("width","150px");
                $(".vtileb").find(".tile-toggle").toggleClass("tile-toggle-min tile-toggle-max");
                $('#'+room.element).attr('class','vtileb');
                $('#'+room.element).find(".tile-toggle").toggleClass("tile-toggle-max tile-toggle-min");
                resizeVideo();
                if(room.ishost) {
                    var button = $("<button/>", 
                        {
                            text: "Start Streaming",
                            click: function(){
                                if($(this).html() == "Start Streaming") {
                                    console.log('startstreaming');
                                    signaling.startStream(room.name);
                                    $(this).html("Stop Streaming");
                                    casting = true;
                                } else {
                                    signaling.endStream(room.name);
                                    $(this).html("Start Streaming");
                                    casting = false
                                }
                            }
                        });
                    if(casting) 
                        button.html("Stop Streaming");
                    $("#videoinfo").empty();
                    $("#videoinfo").append(button);
                }
                $(".user").remove();
                for(key in room.userList) {
                    $("#userlist").append("<span class='user'>" + room.userList[key].nick + "</span>");
                }

            }
            else {
                el(room.element).style.height = '150px';
                el(room.element).style.width = '150px';            
                el(room.element).className = "vtile";
                $(room.element).find(".tile-toggle").toggleClass("tile-toggle-min tile-toggle-max");
                $(".user").remove();
                $("#videoinfo").empty();
            }
        }
        el(room.element).querySelector(".tile-mute").onclick = function() {
            room = roominfo[_roominfo.name];
            tvideo = el(room.element).querySelector(".tvideo");
//            if(this.hasClass("tile-mute"))
//                this.className = "tile-mute-click";
//            else
//                this.className = "tile-mute";
            tvideo.muted = !tvideo.muted;
        }
        el(room.element).querySelector(".tile-leave").onclick = function() {
            room = roominfo[_roominfo.name];
            signaling.leaveRoom(room.name);
        }
     
    },
    change: function(_roominfo) {
        room = roominfo[_roominfo.name];
        console.log(room);
        if(!room)
            return;
        for(key in _roominfo) {
            switch(key) {
                case 'stream':
                
                    room.stream = _roominfo.stream;
                    el(room.name + 'v').src = URL.createObjectURL(room.stream);
                    resizeVideo();
                    break;
                case 'hostname':
                    room.hostname = _roominfo.hostname
                    el(room.element).querySelector('.tile-host').innerHTML = room.hostname;
                    break;
                case 'userList':
                    $(".user").remove();
                    room.userList = _roominfo.userList;
                    if($('#'+room.element).hasClass("vtileb")) {
                        for(key in room.userList) {
                            $("#userlist").append("<span class='user'>" + room.userList[key].nick + "</span>");
                        }
                    }
            }
        }
    },
    remove: function(_roomname) {
        room = roominfo[_roomname];
        el("videolist").removeChild(el(room.element));
        var roomc = document.getElementsByClassName("vtileb").length + document.getElementsByClassName("vtile").length;
        if(roomc == 0) {
            el('empty').style.display = '';
        }
        delete roominfo[room];
            
    }
}
        
var setList = {
    add: function(room) {
        var tr = document.createElement('tr');
        tr.setAttribute("id", room);
        tr.innerHTML = '<td><strong>' + room + 
            '</td><td><button class="join">Join</button></td>';
        table.insertBefore(tr, table.firstChild);       
        tr.querySelector('.join').onclick = function() {
            signaling.joinRoom(this.parentNode.parentNode.getAttribute('id'));
        };
    },
    change: function(room, joined) {
        if(el(room)) {
            if(joined) {
                el(room).innerHTML = '<td><strong>' + room + 
                    '</td><td><button class="join">Leave</button></td>';
                el(room).querySelector('.join').onclick = function() {
                    signaling.leaveRoom(this.parentNode.parentNode.getAttribute('id'));
                }
            } else {
                el(room).innerHTML = '<td><strong>' + room + 
                    '</td><td><button class="join">Join</button></td>';
                el(room).querySelector('.join').onclick = function() {
                    signaling.joinRoom(this.parentNode.parentNode.getAttribute('id'));
                }; 
            }
        }
    },
    remove: function(room) {
        if(el(room)) {
            table.removeChild(el(room));
            
        }
    }
}
    
window.onload = function() {
    fireRef = new Firebase('https://gamertc.firebaseio.com/');
    nickInput = document.getElementById('nickinput');
    chanInput = el('channel-key');
    table = el('session-list');
    if(window.location.hash) 
        document.querySelector('.ichan').value = window.location.hash.substring(1);
    nickInput.onkeyup = function(event) {
        if(event.keyCode == 13) {
            newNick()
        }
    };
    chanInput.onkeyup = function(event) {
        if(event.keyCode == 13) {
            newNick()
        }
    };
    auth = new FirebaseSimpleLogin(fireRef, function(error, user) {
        if (error) {
            console.log(error);
        } else if (user) {
            userid = user.id;
            nickInput.value = userid;
            console.log('User ID: ' + user.id + ', Provider: ' + user.provider);
        } else {
            // user is logged out
        }
    });
    if(userid == null) {
        auth.login('anonymous');
    }
}



function resizeVideo() {       
    videodiv = document.getElementsByClassName('vtileb');
    if(videodiv.length < 1)
        return;
    ewidth = $('#mainvideo').outerWidth();
    eheight = $('#mainvideo').outerHeight()-195;
    videodiv = videodiv.item(0);
    mainvideo = videodiv.querySelector('.tvideo');
    xratio = mainvideo.videoWidth/mainvideo.videoHeight;
    yratio = mainvideo.videoHeight/mainvideo.videoWidth;
    if(isNaN(xratio) || isNaN(yratio)) {
        $(".vtileb").height(eheight);
        $(".vtileb").width(ewidth);
    }
    else if(xratio*eheight < ewidth) {
        console.log('2');
        videodiv.style.height = eheight + 'px';
        videodiv.style.width = Math.floor(xratio*eheight) + 'px';
    } else {
        videodiv.style.height = Math.floor(yratio*ewidth) + 'px';
        videodiv.style.width = ewidth + 'px';
    }
}
window.addEventListener('resize', function(event) {
    resizeVideo();
});    
    
    
    

function newRoom() {
    if(signaling == false) {
        alert('Not in channel');
        return;
    }
    nickInput.value = signaling.getNick();
    if(nickInput.value == null || nickInput.value == "") {
        nickInput.value = signaling.getNick();
        return;
    }   
    signaling.createRoom(document.getElementById('session-name').value);
}

function newNick() {
    if(nickInput.value == null || nickInput.value == "") {
        return
    }
    else if(!signaling) {
        return;
    }   
    else if(signaling.getNick() == nickInput.value) {
        return;
    }
    else {
        signaling.setNick(nickInput.value)
        return
    }
}
var updateNick = function(nick, result) {
    nickInput.value = nick;
    if(result == false) {
        alert("Failed to set nick");
    }
}
function changeChannel(evt,ele) {
    if(evt.keyCode != 13)
        return;
    if(ele.value == null || ele.value == "") {
        ele.value = channel;
        return;
    }
    channel = ele.value;
    window.location.hash = '#' + ele.value;
    if(signaling) {
        signaling.reset(fireRef, nickInput.value, ele.value, userid, joinedRooms, setList, setNick);
        signaling.run();
    }
}
 
function connect_enter(evt,ele) {
    if( evt.keyCode == 13)
        connect(ele)
}
function connect(ele) {
    if(signaling)
        return;
    tnick = ele.parentNode.querySelector('.inick');
    tchannel = ele.parentNode.querySelector('.ichan');
    fail = 0;
    if(tnick.value == null || tnick.value == "") {
        tnick.classList.remove('border_blink');
        tnick.offsetWidth = tnick.offsetWidth; //Hack to force animation reset
        tnick.classList.add('border_blink');
        fail = 1;
    }
    if(tchannel.value == null || tchannel.value == "") {
        tchannel.classList.remove('border_blink');
        tchannel.offsetWidth = tchannel.offsetWidth;
        tchannel.classList.add('border_blink');
        fail = 1;
    }
    if(fail)
        return
    window.location.hash = '#' + tchannel.value;
    if(signaling) {
        signaling.reset(fireRef, tnick.value, tchannel.value, userid, joinedRooms, setList, setNick);  
    }
    el('channel-key').value = tchannel.value;
    el('splash').classList.add('connected');
    el('splash').addEventListener("transitionend", function() {
        el('splash').className += " hideo";
    }, true);
    el('videolist').className = "showlist";    
    el('videolist').addEventListener("transitionend", function() {
        el('videolist').style.overflowX = "scroll";
    }, true);
    el('leftcol').className = "colshow";
    signaling = new RoomConnection(fireRef, tnick.value, tchannel.value, userid, joinedRooms, setList, setNick);
    signaling.run();
    channel = tchannel.value;
    
}
    
