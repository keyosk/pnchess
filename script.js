var v = '1.04';

var ROOM = (location.href.match(/room=([^&]+)/)||['']).slice(-1)[0] || prompt('Chess Room Name?')

var CHESS_CHANNEL_NAME = v + ':codychesstest:' + ROOM;

var YOUR_NAME = (location.href.match(/nick=([^&]+)/)||['']).slice(-1)[0] || prompt('Your name?');

var chatters = { };

var pubnub = PUBNUB.init({
  subscribe_key   : 'sub-c-cbcff300-bb84-11e3-b6e0-02ee2ddab7fe',
  publish_key : 'pub-c-01bb4e6e-4ad8-4c62-9b72-5278a11cf9e5'
});

var game;

var throttle = function(fn, threshhold, scope) {
  threshhold || (threshhold = 250);
  var last,
      deferTimer;
  return function () {
    var context = scope || this;

    var now = +new Date,
        args = arguments;
    if (last && now < last + threshhold) {
      // hold on to it
      clearTimeout(deferTimer);
      deferTimer = setTimeout(function () {
        last = now;
        fn.apply(context, args);
      }, threshhold);
    } else {
      last = now;
      fn.apply(context, args);
    }
  };
};

var get_all_history = function(args) {
    var channel  = args['channel']
    ,   callback = args['callback']
    ,   start    = 0
    ,   count    = 100
    ,   history  = []
    ,   params   = {
            channel  : channel,
            count    : count,
            reverse : false,
            callback : function(messages) {
                var msgs = messages[0];
                start = messages[1];
                params.start = start;
                pubnub.each( msgs.reverse(), function(m) {history.push(m)} );
                if (msgs.length < count) return callback(history);
                count = 100;
                add_messages();
            }
        };

    add_messages();
    function add_messages() { pubnub.history(params) }
}

var parsePubnubMessage = function(data, type) {
  var messages = [];
  if (type === 'subscribe') {
    messages.push(data);
  } else if (type === 'history') {
    messages = data;
  }
  for (var idx in messages) {
    if (messages[idx].type === 'move') {
      if (type === 'subscribe' && messages[idx].uuid === pubnub.get_uuid()) {
        return;
      }
      game.move(messages[idx].start,messages[idx].end,messages[idx].promotion,messages[idx].uuid);
    } else if (messages[idx].type === 'chat') {
      var msg = '<' + messages[idx].date + '> [' + messages[idx].name + '] : ' + messages[idx].msg;
      game.messages(msg);
    } else if (messages[idx].type === 'start_moving_piece' && type === 'subscribe' && messages[idx].uuid !== pubnub.get_uuid()) {
      game.start_moving_piece(messages[idx].position, messages[idx].uuid);
    } else if (messages[idx].type === 'stop_moving_piece' && type === 'subscribe' && messages[idx].uuid !== pubnub.get_uuid()) {
      game.stop_moving_piece(messages[idx].uuid);
    } else if (messages[idx].type === 'adjust_moving_piece' && type === 'subscribe' && messages[idx].uuid !== pubnub.get_uuid()) {
      game.adjust_moving_piece(messages[idx].x,messages[idx].y);
    } else if (messages[idx].type === 'new_game') {
      game = p4wnify("chess-board");
      game.redrawChatters(chatters);
      game.refresh();
    }
  }
};

var getChatterState = function(uuid) {
  pubnub.state({
    channel : CHESS_CHANNEL_NAME,
    uuid : uuid,
    callback : function(data) {
      if (data.hasOwnProperty('name')) {
        chatters[uuid] = data.name
        game.redrawChatters(chatters);
        game.refresh();
      }
    }
  });
};

var refreshChatters = function() {
  pubnub.here_now({
    channel : CHESS_CHANNEL_NAME,
    callback : function(msg) {
      for (var idx in msg.uuids) {
        getChatterState(msg.uuids[idx]);
      }
    }
  });
};

var parsePubNubPresence = function(message) {
  if (message.action === 'join' && message.hasOwnProperty('data')) {
    chatters[message.uuid] = message.data.name;
    game.redrawChatters(chatters);
  } else if (message.action === 'join' && !message.hasOwnProperty('data')) {
    setTimeout(function() {
      getChatterState(message.uuid);
    }, 1500);
  } else if (message.action === 'leave' || message.action === 'timeout') {
    chatters[message.uuid] = null;
    delete chatters[message.uuid];
    game.redrawChatters(chatters);
  }
};

var sendChatMessage = function(msg) {
  pubnub.publish({
    channel : CHESS_CHANNEL_NAME,
    message : {
      date : (new Date()).toUTCString(),
      name : YOUR_NAME,
      type : 'chat',
      msg : msg
    }
  });
};

var game = p4wnify("chess-board");

pubnub.subscribe({
  noheresync : true,
  channel : CHESS_CHANNEL_NAME,
  state : {
    name: YOUR_NAME
  },
  message : function(message) {
    parsePubnubMessage(message, 'subscribe');
  },
  presence : function(message) {
    parsePubNubPresence(message);
  }
});

sendChatMessage('has joined!');

setTimeout(function() {

  refreshChatters();

  get_all_history({
      channel  : CHESS_CHANNEL_NAME,
      callback : function(messages) {
        parsePubnubMessage(messages.reverse(), 'history');
      }
  });

},1500);

var newGame = function() {
  pubnub.publish({
    channel : CHESS_CHANNEL_NAME,
    message : {
      type : 'new_game'
    }
  });
};
