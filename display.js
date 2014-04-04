/* p4wn, AKA 5k chess - by Douglas Bagnall <douglas@paradise.net.nz>
 *
 * This code is in the public domain, or as close to it as various
 * laws allow. No warranty; no restrictions.
 *
 * lives at http://p4wn.sf.net/
 */
/* The routines here draw the screen and handle user interaction */

var P4WN_SQUARE_WIDTH = 30;
var P4WN_SQUARE_HEIGHT = 30;
var P4WN_WRAPPER_CLASS = 'p4wn-wrapper';
var P4WN_BOARD_CLASS = 'p4wn-board';
var P4WN_MESSAGES_CLASS = 'p4wn-messages';
var P4WN_SEND_MESSSAGE_CLASS = 'p4wn-send-message';
var P4WN_STATUS_CLASS = 'p4wn-status';
var P4WN_LOG_CLASS = 'p4wn-log';
var P4WN_BLACK_SQUARE = 'p4wn-black-square';
var P4WN_WHITE_SQUARE = 'p4wn-white-square';

var P4WN_ROTATE_BOARD = true;
var P4WN_LEVELS = ['stupid', 'middling', 'default', 'slow', 'slowest'];
var P4WN_DEFAULT_LEVEL = 2;
var P4WN_ADAPTIVE_LEVELS = false;

var P4WN_IMAGE_DIR = 'images';

var P4WN_IMAGE_NAMES = [
    'empty.gif',
    '',   // 1 is unused
    'white_pawn.gif',
    'black_pawn.gif',
    'white_rook.gif',
    'black_rook.gif',
    'white_knight.gif',
    'black_knight.gif',
    'white_bishop.gif',
    'black_bishop.gif',
    'white_king.gif',
    'black_king.gif',
    'white_queen.gif',
    'black_queen.gif'
];


/*the next two should match*/
var P4WN_PROMOTION_STRINGS = ['queen', 'rook', 'knight', 'bishop'];
var P4WN_PROMOTION_INTS = [P4_QUEEN, P4_ROOK, P4_KNIGHT, P4_BISHOP];

var _p4d_proto = {};


/* MSIE 6 compatibility functions */
function _add_event_listener(el, eventname, fn){
    if (el.addEventListener === undefined){
        el.attachEvent('on' + eventname, fn);
    }
    else {
        el.addEventListener(eventname, fn);
    }
}

function _event_target(e){
    /*e.srcElement is not quite equivalent, but nothing is closer */
    return (e.currentTarget) ? e.currentTarget : e.srcElement;
}

_p4d_proto.square_clicked = function(square){
    var board = this.board_state.board;
    var mover = this.board_state.to_play;
    var uuid = pubnub.get_uuid();
    if (locked_players[mover] !== false && locked_players[mover] !== uuid) {
        p4_log("not your turn!");
        return;
    }
    if (this.players[mover] == 'computer'){
        p4_log("not your turn!");
        return;
    }
    var piece = board[square];
    if (this.start == square){
        //clicked back on previously chosen piece -- putting it down again
        this.stop_moving_piece();
    }
    else if (piece && (mover == (piece & 1))){
        //clicked on player's colour, so it becomes start
        this.start_moving_piece(square);
    }
    else if (this.move(this.start, square, P4WN_PROMOTION_INTS[this.pawn_becomes])){
        /*If the move works, drop the piece.*/
        //this.stop_moving_piece(square);
    }
};

var locked_players = [false,false];

_p4d_proto.move = function(start, end, promotion, do_not_broadcast){

    var uuid = pubnub.get_uuid();

    if (do_not_broadcast) {
        uuid = do_not_broadcast;
    }

    if (locked_players[this.board_state.to_play] === false) {
        locked_players[this.board_state.to_play] = uuid;
    } else if (locked_players[this.board_state.to_play] !== uuid) {
        this.messages('Someone has already claimed this color, please claim another color or spectate');
        return false;
    }

    var state = this.board_state;
    var move_result = state.move(start, end, promotion);
    if(move_result.ok){
        if (!do_not_broadcast) {
            pubnub.publish({'channel':CHESS_CHANNEL_NAME,'message':{type:'move',start:start,end:end,promotion:promotion,uuid:pubnub.get_uuid()}});
        }
        this.display_move_text(state.moveno, move_result.string);
        this.refresh();
        if (! (move_result.flags & P4_MOVE_FLAG_MATE)){
            this.next_move_timeout = window.setTimeout(
                function(p4d){
                    return function(){
                        p4d.next_move();
                    };
                }(this), 1);
        }
    }
    else {
        p4_log("bad move!", start, end);
    }
    for (var i = 0; i < this.move_listeners.length; i++){
        this.move_listeners[i](move_result);
    }
    if (move_result.ok) {
        this.stop_moving_piece(start);
    }
    return move_result.ok;
};

_p4d_proto.next_move = function(){
    var mover = this.board_state.to_play;
    if (this.players[mover] == 'computer' &&
        this.auto_play_timeout === undefined){
        var timeout = (this.players[1 - mover] == 'computer') ? 500: 10;
        var p4d = this;
        this.auto_play_timeout = window.setTimeout(function(){p4d.computer_move();},
                                                   timeout);
    }
};

_p4d_proto.computer_move = function(){
    this.auto_play_timeout = undefined;
    var state = this.board_state;
    var mv;
    var depth = this.computer_level + 1;
    var start_time = Date.now();
    mv = state.findmove(depth);
    var delta = Date.now() - start_time;
    p4_log("findmove took", delta);
    if (P4WN_ADAPTIVE_LEVELS && depth > 2){
        var min_time = 25 * depth;
        while (delta < min_time){
            depth++;
            mv = state.findmove(depth);
            delta = Date.now() - start_time;
            p4_log("retry at depth", depth, " total time:", delta);
        }
    }
    this.move(mv[0], mv[1]);
};

_p4d_proto.display_move_text = function(moveno, string){
    var mn;
    if ((moveno & 1) == 0){
        mn = '    ';
    }
    else{
        mn = ((moveno >> 1) + 1) + ' ';
        while(mn.length < 4)
            mn = ' ' + mn;
    }
    this.log(mn + string, "p4wn-log-move",
             function (p4d, n){
                 return function(e){
                     p4d.goto_move(n);
                 };
             }(this, moveno));
};

_p4d_proto.log = function(msg, klass, onclick){
    var div = this.elements.log;
    var item = p4d_new_child(div, "div");
    item.className = klass;
    //if (onclick !== undefined)
        //_add_event_listener(item, "click", onclick);
    item.innerHTML = msg.replace(/[<>]/g,'');
    div.scrollTop = div.scrollHeight;
}

_p4d_proto.status = function(msg){
    var div = this.elements.status;
    div.innerHTML = msg.replace(/[<>]/g,'');
    sounds.play('chat');
}

_p4d_proto.messages = function(msg){
    var div = this.elements.messages;
    var item = p4d_new_child(div, "div");
    item.innerHTML = msg.replace(/[<>]/g,'');
    div.scrollTop = div.scrollHeight;
    sounds.play('chat');
}

_p4d_proto.redrawChatters = function(msg){
    var div = this.elements.players_list;
    div.innerHTML = '';
    for (var idx in msg) {
        var item = p4d_new_child(div, "div");
        item.innerHTML = msg[idx].replace(/[<>]/g,'');
    }
    div.scrollTop = div.scrollHeight;
}

_p4d_proto.goto_move = function(n){
    return;
    var delta;
    if (n < 0)
        delta = -n;
    else
        delta = this.board_state.moveno - n;
    if (delta > this.board_state.moveno)
        delta = this.board_state.moveno;
    var div = this.elements.log;
    for (var i = 0; i < delta; i++){
        div.removeChild(div.lastChild);
    }
    this.board_state.jump_to_moveno(n);
    this.refresh();
    this.next_move();
};


//refresh: redraw screen from board

_p4d_proto.refresh = function(){
    var pieces = this.elements.pieces;
    var board = this.board_state.board;
    for (var i = 20; i < 100; i++){
        if(board[i] != P4_EDGE){
            var j = this.orientation ? 119 - i : i;
            pieces[j].src = P4WN_IMAGE_DIR + '/' + P4WN_IMAGE_NAMES[board[i]];
        }
    }
    if (chatters) {
        var uuid = locked_players[this.board_state.to_play];
        var color = this.board_state.to_play === 0 ? 'WHITE' : 'BLACK';
        var name = chatters[uuid] ? chatters[uuid] : false;
        if (name) {
            this.status(color + "'s turn : (" + name + ")");
        } else {
            this.status(color + "'s turn");
        }
    }
};

_p4d_proto.adjust_moving_piece = function(x,y) {
    if (this.elements.moving_img) {
        this.elements.moving_img.style.left = x + "px";
        this.elements.moving_img.style.top = y + "px";
    }
};

_p4d_proto.start_moving_piece = function(position, do_not_broadcast){
    /*drop the currently held one, if any*/
    this.stop_moving_piece(true);
    if (!do_not_broadcast) {
        pubnub.publish({'channel':CHESS_CHANNEL_NAME,'message':{type:'start_moving_piece',position:position,uuid:pubnub.get_uuid()}});
    }
    this.elements.orig_img = this.elements.pieces[this.orientation ? 119 - position : position];
    var img = this.elements.pieces[this.orientation ? 119 - position : position].cloneNode(false);
    this.elements.orig_img.style.opacity = '0.2';
    this.elements.orig_img.parentNode.appendChild(img);
    this.elements.moving_img = img;
    var old_msie = /MSIE [56]/.test(navigator.userAgent);
    img.style.position = (old_msie) ? 'absolute': 'fixed';
    var yoffset = parseInt(P4WN_SQUARE_HEIGHT / 2);
    if (window.event){
        img.style.left = (window.event.clientX + 1) + "px";
        img.style.top = (window.event.clientY - yoffset) + "px";
    }
    this.start = position;
    var throttledPublish = throttle(function() {
        pubnub.publish({'channel':CHESS_CHANNEL_NAME,'message':{type:'adjust_moving_piece',x:x,y:y,uuid:pubnub.get_uuid()}});
    }, 500);
    if (!do_not_broadcast) {
        document.onmousemove = function(e){
            e = e || window.event;
            x = (e.clientX + 1);
            y = (e.clientY - yoffset);
            img.style.left = x + "px";
            img.style.top = y + "px";
            throttledPublish();
        };
    }
};

_p4d_proto.stop_moving_piece = function(do_not_broadcast){
    if (!do_not_broadcast) {
        pubnub.publish({'channel':CHESS_CHANNEL_NAME,'message':{type:'stop_moving_piece',uuid:pubnub.get_uuid()}});
    }
    if (this.elements.orig_img) {
        this.elements.orig_img.style.opacity = '1.0';
    }
    var img = this.elements.moving_img;
    if (img){
        img.parentNode.removeChild(img);
    }
    this.start = 0;
    this.elements.moving_img = undefined;
    document.onmousemove = null;
};

function p4d_new_child(element, childtag, className){
    var child = document.createElement(childtag);
    element.appendChild(child);
    if (className !== undefined)
        child.className = className;
    return child;
}

_p4d_proto.write_board_html = function(){
    var div = this.elements.board;
    var pieces = this.elements.pieces = [];
    var table = p4d_new_child(div, "table");
    var tbody = p4d_new_child(table, "tbody");
    for (var y = 9; y > 1; y--){
        var tr = p4d_new_child(tbody, "tr");
        for(var x = 1;  x < 9; x++){
            var i = y * 10 + x;
            var td = p4d_new_child(tr, "td");
            td.className = (x + y) & 1 ? P4WN_BLACK_SQUARE : P4WN_WHITE_SQUARE;
            _add_event_listener(td, 'click',
                                function(p4d, n){
                                    return function(e){
                                        p4d.square_clicked(p4d.orientation ? 119 - n : n);
                                    };
                                }(this, i));
            var img = p4d_new_child(td, "img");
            pieces[i] = img;
            img.src = P4WN_IMAGE_DIR + '/' + P4WN_IMAGE_NAMES[0];
            img.width= P4WN_SQUARE_WIDTH;
            img.height= P4WN_SQUARE_HEIGHT;
        }
    }
};

_p4d_proto.refresh_buttons = function(){
    var rf = this.buttons.refreshers;
    for (var i = 0; i < rf.length; i++){
        var x = rf[i];
        x[0].call(this, x[1]);
    }
};

_p4d_proto.maybe_rotate_board = function(){
    var p = this.players;
    if (p[0] != p[1] && P4WN_ROTATE_BOARD){
        this.orientation = p[0] == 'computer' ? 1 : 0;
        this.refresh();
    }
};

_p4d_proto.flip_player = function(i){
    return;
    this.players[i] = (this.players[i] == 'human') ? 'computer' : 'human';
    this.refresh_buttons();
    this.maybe_rotate_board();
    this.next_move();
};

function P4wn_display(target){
    if (! this instanceof P4wn_display){
        return new P4wn_display(target);
    }
    var container;
    if (typeof(target) == 'string')
        container = document.getElementById(target);
    else if (target.jquery !== undefined)
        container = target.get(0);
    else
        container = target;
    var inner = p4d_new_child(container, "div", P4WN_WRAPPER_CLASS);
    this.elements = {};
    this.elements.inner = inner;
    this.elements.container = container;
    this.elements.status = p4d_new_child(inner, "div", P4WN_STATUS_CLASS);
    var board = this.elements.board = p4d_new_child(inner, "div", P4WN_BOARD_CLASS);
    var players_list = this.elements.players_list = p4d_new_child(inner, "div", 'players-list');
    var log = this.elements.log = p4d_new_child(inner, "div", P4WN_LOG_CLASS);
    var send_message = this.elements.send_message = p4d_new_child(inner, "input", P4WN_SEND_MESSSAGE_CLASS);

    pubnub.bind('keypress', send_message, function(e) {
        if (e.which === 13) {
            sendChatMessage(send_message.value);
            send_message.value = '';
        }
        return true;
    });
    this.elements.messages = p4d_new_child(inner, "div", P4WN_MESSAGES_CLASS);
    //this.elements.controls = p4d_new_child(container, "div", P4WN_CONTROLS_CLASS);
    this.start = 0;
    this.draw_offers = 0;
    this.board_state = p4_new_game();
    this.players = ['human', 'human']; //[white, black] controllers
    this.pawn_becomes = 0; //index into P4WN_PROMOTION_* arrays
    this.computer_level = P4WN_DEFAULT_LEVEL;
    this.buttons = {
        elements: [],
        refreshers: []
    };
    this.move_listeners = [];
    return this;
}

function p4wnify(id){
    var p4d = new P4wn_display(id);
    var e = p4d.elements;
    var board_height = (8 * (P4WN_SQUARE_HEIGHT + 3)) + 'px';
    e.inner.style.height = board_height;
    e.log.style.height = board_height;
    e.board.style.height = board_height;
    //e.controls.style.width = (15 * P4WN_SQUARE_WIDTH) + 'px';
    p4d.write_board_html();
    //p4d.interpret_query_string();
    p4d.status("WHITE's turn");
    p4d.refresh();
    return p4d;
}

P4wn_display.prototype = _p4d_proto;
