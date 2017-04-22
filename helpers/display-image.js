var pictureTube = require('picture-tube');
var streamifier = require("streamifier");
var Jimp = require('jimp');

function displayImage(img) {
    var tube = pictureTube({cols: Math.min(img.bitmap.width, process.stdout.columns - 1)});
    tube.setMaxListeners(1000);

    return new Promise(function(resolve, reject){
            img.getBuffer(Jimp.MIME_PNG, function(err, buffer){
                if (err) reject();

                tube.once('error', reject);
                tube.once('end', resolve);

                tube.pipe(process.stdout);
                streamifier
                    .createReadStream(buffer)
                    .pipe(tube);
            });
        });
}

module.exports = displayImage;
