'use strict';

// error code:
// 1 : datastore error
// 2 : image manipulation error


var defaultAvatarSize = 128;
var logger = require('..').logger;
var PassThrough = require('stream').PassThrough;
var gm = require('gm');
var filestore = require('..').filestore;
var async = require('async');

function getDuplicates(readable) {
  var p1 = new PassThrough();
  var p2 = new PassThrough();
  readable.pipe(p1);
  readable.pipe(p2);
  return [p1, p2];
}

function getSize(readable, callback) {
  gm(readable)
  .size({bufferStream: true}, function(err, size) {
    if (err) {
      logger.error('Failed to get image size');
      logger.debug(err);
      err.code = 2;
      return callback(err);
    }
    return callback(null, size, this);
  });
}

function checkImageSquare(readable, callback) {
  getSize(readable, function(err, size, gmInstance) {
    if (err) {
      return callback(err);
    }
    var sizeWidthMin = size.height - 2;
    var sizeWidthMax = size.height + 2;
    if (size.width < sizeWidthMin || size.width > sizeWidthMax) {
      logger.debug('image is not a square');
      var error = new Error('Image is not a square');
      error.code = 2;
      return callback(error);
    }
    return callback(null, size, gmInstance);
  });
}


function recordAvatar(id, contentType, opts, readable, callback) {
  var streams = getDuplicates(readable);
  var responses = {
    datastore: {},
    gm: {}
  };
  async.parallel(
    [
      function(callback) {
        filestore.store(id, contentType, opts, streams[0], function(err, size) {
          if (err) {
            logger.debug('failed to record original image');
            logger.debug(err);
            responses.datastore = {error: err, size: size};
            responses.datastore.error.code = 1;
          } else {
            responses.datastore.size = size;
          }
          callback();
        });
      },
      function(callback) {
        checkImageSquare(streams[1], function(err, size, gmInstance) {
          if (err) {
            responses.gm.error = err;
          } else {
            responses.gm.size = size;
            responses.gm.image = gmInstance;
          }
          callback();
        });
      }
    ],
    function(err, resps) {
      if (responses.datastore.error) {
        return callback(responses.datastore.error);
      }
      if (responses.gm.error) {
        filestore.delete(id, function() {});
        return callback(responses.gm.error);
      }

      var resizedId = id + '-' + defaultAvatarSize;
      responses.gm.image.resize(defaultAvatarSize, defaultAvatarSize);
      responses.gm.image.stream(function(err, stdout, stderr) {
        if (err) {
          logger.debug('failed to stream gm image after resize');
          logger.debug(err.stack);
          filestore.delete(id, function() {});
          err.code = 2;
          return callback(err);
        }
        filestore.store(resizedId, contentType, opts, stdout, function(err) {
          if (err) {
            logger.debug('failed to record resized image');
            logger.debug(err.stack);
            filestore.delete(id, function() {});
            err.code = 1;
            return callback(err);
          }
        });
      });
      return callback(null, responses.datastore.size);
    }
  );

}

function setDefaultAvatarSize(size) {
  var s = parseInt(size);
  if (isNaN(s)) {
    return false;
  }
  defaultAvatarSize = s;
  return true;
}

module.exports.getSize = getSize;
module.exports.checkImageSquare = checkImageSquare;
module.exports.recordAvatar = recordAvatar;
module.exports.setDefaultAvatarSize = setDefaultAvatarSize;
