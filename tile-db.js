var _ = require("lodash");
var throwOut = require('./helpers/throw-out');
// var TileSheet = require('./tile-sheet');
var Jimp = require('jimp');
var Tile = require('./tile');
var inquirer = require('inquirer');
var throwOut = require('./helpers/throw-out');
var thenify = require('thenify');
var DataStore = require('nedb');
var displayImage = require('./helpers/display-image');
var slug = require('slug')
var path = require('path');
var padNumber = require('pad-number');
var mkdirp = require('mkdirp-then');
var del = require('del');

class TileDB {
    constructor(DBPath) {
        this.db = new DataStore({ filename: DBPath });
        this.db.loadDatabase = thenify(this.db.loadDatabase);
        this.db.find = thenify(this.db.find);
        this.db.findOne = thenify(this.db.findOne);
        this.db.insert = thenify(this.db.insert);
        this.db.update = thenify(this.db.update);
        this.db.remove = thenify(this.db.remove);
    }

    init() {
        return this.db.loadDatabase();
    }

    list(tileSheetName) {
        return this.db.find({tileSheetName: tileSheetName})
            .then(function(results){
                return _.reduce(results, function(promise, result){
                    return promise
                        .then(function(){
                            return Tile.deserialize(result)
                                .then(function(tile){
                                    return displayImage(tile.img)
                                        .then(function(){
                                            console.log(tile.hash, tile.width + "x" + tile.height);
                                        });
                                });
                        })
                }, Promise.resolve());
            })
    }

    removeTile(tileSheetName, tileIndices, outputPath) {
        var self = this;
        if (!tileIndices) {
            var promise = self.db.remove({tileSheetName: tileSheetName}, {multi:true});
        } else {
            tileIndices.sort(function(a,b){
                return b - a;
            });
            tileIndices = _.uniq(tileIndices);

            promise = self.db.remove({ tileIndex: { $in: _.map(tileIndices, (index => Number(index) - 1)) }}, {multi:true})
                .then(function(removedTiles){
                    console.log("Removed", removedTiles, "tiles.");
                    return  _.reduce(tileIndices, function(getTilePromise, tileIndex){
                        return self.db.update({
                                tileSheetName: tileSheetName,
                                tileIndex: {
                                    $gt: tileIndex - 1
                                }
                            }, {
                                $inc: {
                                    tileIndex: -1
                                }
                            }, {
                                multi: true
                            });
                    }, Promise.resolve());
                }, function(err){
                    console.error("Failed to remove tiles.", err);
                });
        }
        return promise
            .then(function(){
                return self.write(outputPath, tileSheetName);
            });
    }

    write(outputPath, tileSheetName) {
        var queryObj = {};
        if (tileSheetName) {
            queryObj.tileSheetName = tileSheetName;
        }
        return this.db.find(queryObj)
            .then(function(results){
                return Promise.all(_.map(_.groupBy(results, 'tileSheetName'), function(tileGroup, tileSheetName){
                    var tileDir = path.join(outputPath, tileSheetName);
                    var deletePromise = del(tileDir, {force:true});

                    return Promise.all(_.map(tileGroup, function(result, key){
                        return Tile.deserialize(result)
                            .then(function(tile){
                                // console.log(tile.tileIndex, tileDir);
                                return deletePromise
                                    .then(function(){
                                        return mkdirp(tileDir)
                                            .then(function(){
                                                var tilePath = path.format({
                                                    dir: tileDir,
                                                    name: tile.tileSheetName + '-'  + padNumber(tile.tileIndex + 1, 2),
                                                    ext: '.png'
                                                });
                                                // console.log(tilePath);
                                                return tile.img.write(tilePath);
                                            });
                                    });
                            });
                    }));
                }))
                .then(function(){
                    console.log("Wrote all tiles to files.");
                });
            });
    }

    addTile(newTile) {
        var self = this;

        return this.db.find({tileSheetName: newTile.tileSheetName})
            .then(function(results){
                newTile.tileIndex = results.length;
                return newTile.serialize()
                    .then(function(serializedTile){
                        return self.db.insert(serializedTile);
                    });
            });
    }

    sliceTileSheet(imgs, tileSheetName, tileWidth, tileHeight, outputPath, skipAudit, skipValidation) {
        if (_.isUndefined(skipAudit)) skipAudit = false;
        if (_.isUndefined(skipValidation)) skipValidation = false;

        if (outputPath) {
            var rejectedPath = path.join(outputPath, 'Rejected');
        }
        if (!Array.isArray(imgs)) {
            imgs = [imgs];
        }
        var self = this;
        return self.db.find({tileSheetName: tileSheetName})
            .then(function(results){
                return Promise.all(_.map(results, Tile.deserialize))
                    .then(function(oldTiles){
                        var promise = Promise.resolve(
                            _.flatMap(imgs, function(img){
                                return Tile.slice(img, tileSheetName, Number(tileWidth), Number(tileHeight))
                            })
                        );

                        if (!skipValidation) {
                            promise = promise.then(function(slicedTiles){
                                return Tile.rejectInvalid(
                                    slicedTiles,
                                    oldTiles,
                                    rejectedPath
                                );
                            });
                        }

                        if (!skipAudit) {
                            var skippedTiles = [];

                            promise = promise.then(function(validTiles){
                                validTiles = _.difference(validTiles, oldTiles);

                                return _.reduce(validTiles, function(promise, tile){
                                        return promise
                                            .then(function(confirmedTiles){
                                                return tile.confirm()
                                                    .then(function(answer){
                                                        return confirmedTiles.concat(tile);
                                                    }, function(){
                                                        console.log("Skipping tile.");
                                                        skippedTiles.push(tile);
                                                        return confirmedTiles;
                                                    });
                                            });
                                    }, Promise.resolve([]))
                            });
                        }

                        promise = promise
                            .then(function(confirmedTiles){
                                return _.reduce(confirmedTiles, function(promise, confirmedTile){
                                    return promise.then(function(){
                                        return self.addTile(confirmedTile);
                                    });
                                }, Promise.resolve());
                            });

                        if (skippedTiles && rejectedPath) {
                            var skippedDir = path.join(rejectedPath, 'Skipped');
                            promise = promise
                                .then(function(){
                                    return mkdirp(skippedDir)
                                        .then(function(){
                                            Promise.all(
                                                _.map(skippedTiles, function(tile){
                                                    return tile.img.write(path.format({dir: skippedDir, base: 'skipped-' + tile.hash + '.png'}));
                                                })
                                            );
                                        });
                                });
                        }

                        return promise;
                    })
                    .then(function(){
                        console.log("Done adding tiles to DB.");
                        if (outputPath) {
                            return self.write(outputPath, tileSheetName);
                        }
                    });
            })
    }
}

module.exports = TileDB;
