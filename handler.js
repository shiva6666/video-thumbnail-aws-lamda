'use strict';
process.env.PATH = process.env.PATH + ":/var/task";
process.env["FFMPEG_PATH"] = process.env["LAMBDA_TASK_ROOT"] + "/ffmpeg";

var child_process = require("child_process");
var async = require('async');
var AWS = require('aws-sdk');
var util = require('util');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
let MAX_HEIGHT = 240;
let MAX_WIDTH = 320;

var s3 = new AWS.S3();

module.exports.cool = (event, context, callback) => {
  var tmpFile = fs.createWriteStream("/tmp/screenshot.jpg");
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;
  var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
  //var dstKey = srcKey.substr(srcKey.replace(/\.\w+$/, ".jpg"));
  //var dstKey = srcKey.substr(srcKey.lastIndexOf('/') + 1);
  var dstKey = srcKey.replace(/\.\w+$/, ".jpg");
  var target = s3.getSignedUrl("getObject", {
    Bucket: bucket,
    Key: srcKey,
    Expires: 900
  });

  async.waterfall([

      function generateThumbnail(next) {
        var ffmpeg = child_process.spawn("ffmpeg", [
          "-ss", "00:00:05", // time to take screenshot
          "-i", target, // url to stream from
          "-vf", "thumbnail,scale=" + MAX_WIDTH + ":" + MAX_HEIGHT,
          "-qscale:v", "2",
          "-frames:v", "1",
          "-f", "image2",
          "-c:v", "mjpeg",
          "pipe:1"
        ]);
        ffmpeg.on("error", function(err) {
          console.log(err);
        })
        ffmpeg.on("close", function(code) {
          if (code != 0) {
            console.log("child process exited with code " + code);
          } else {
            console.log("Processing finished !");
          }
          tmpFile.end();
          next(code);
        });
        tmpFile.on("error", function(err) {
          console.log("stream err: ", err);
        });
        ffmpeg.on("end", function() {
          tmpFile.end();
        })
        ffmpeg.stdout.pipe(tmpFile)
          .on("error", function(err) {
            console.log("error while writing: ", err);
          });
      },
      function upload(next) {
        var tmpFile = fs.createReadStream("/tmp/screenshot.jpg");
        child_process.exec("echo `ls -l -R /tmp`",
          function(error, stdout, stderr) {
            console.log("stdout: " + stdout) // for checking on the screenshot
          });

        var params = {
          Bucket: bucket,
          Key: dstKey,
          Body: tmpFile,
          ContentType: "image/jpg"
        };

        var uploadMe = s3.upload(params);
        uploadMe.send(
          function(err, data) {
            if (err != null) console.log("error: " + err);
            next(err);
          }
        );
      }
    ],
    function(err) {
      if (err) {
        console.error(
          'Unable to generate thumbnail from the bucket: ' + bucket + '/' + srcKey +
          ' and upload to bucket: ' + bucket + '/' + dstKey +
          ' due to an error: ' + err
        );
      } else {
        console.log(
          'Successfully generated thumbnail ' + bucket + '/' + srcKey +
          ' and uploaded to ' + bucket + '/' + dstKey
        );
      }
    });
  callback(null);
};
