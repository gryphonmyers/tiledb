#!/usr/bin/env node

var _ = require("lodash");
var yargs = require('yargs');
var TileDB = require('./tile-db');
var Jimp = require('jimp');
var throwOut = require('./helpers/throw-out');
var fs = require('mz/fs');
var recursiveReadDir = require('recursive-readdir');
var path = require('path');
var Tile = require('./tile');

const CONFIG_PATH = './config.json';



function writeConfig(config) {
    return fs.writeFile(CONFIG_PATH, JSON.stringify(config))
        .then(function(){
            return config;
        });
}

function openConfig() {
    return fs.readFile(CONFIG_PATH)
        .then(function(data){
            return JSON.parse(data);
        },function(){
            config = {DBPath : './', DBFileName: 'tiledb', outputPath: __dirname};
            return writeConfig(config);
        })
}

function readImageFile(src) {

}

openConfig()
    .then(function(config){
        var tileDB = new TileDB(path.format({dir: config.DBPath, base: config.DBFileName}));

        yargs
            .command({
                command: 'add <src> <tileSheetName>',
                description: 'Add a tile image to the db',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return fs.lstat(args.src)
                                .then(function(stats){
                                    var promise;

                                    if (stats.isDirectory()) {
                                        promise = recursiveReadDir(args.src, [function(file, stats) {
                                            return stats.isDirectory() || !_.includes(['.png', '.jpg'], path.extname(file));
                                        }]);
                                    } else {
                                        promise = Promise.resolve([args.src]);
                                    }

                                    return promise
                                        .then(function(filePaths){
                                            return _.reduce(filePaths, function(promise, filePath){
                                                return promise.then(function(){
                                                    return Jimp.read(filePath)
                                                        .then(function(imgObj) {
                                                            return tileDB.addTile(new Tile(
                                                                imgObj,
                                                                args.tileSheetName,
                                                                imgObj.bitmap.width,
                                                                imgObj.bitmap.height
                                                            ));
                                                        });
                                                    });
                                            }, Promise.resolve());
                                        });
                                });
                        }, throwOut)
                }
            })
            .command({
                command: 'slice <src> <name> <tileWidth> <tileHeight> [outputPath]',
                description: 'Slice a tileset image and add all sliced tiles to the DB',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return fs.lstat(args.src)
                                .then(function(stats){
                                    var promise;

                                    if (stats.isDirectory()) {
                                        promise = recursiveReadDir(args.src, [function(file, stats) {
                                            return stats.isDirectory() || !_.includes(['.png', '.jpg'], path.extname(file));
                                        }]);
                                    } else {
                                        promise = Promise.resolve([args.src]);
                                    }

                                    return promise.then(function(filePaths){
                                        return _.reduce(filePaths, function(promise, filePath){
                                            return promise.then(function(){
                                                return Jimp.read(filePath)
                                                    .then(function(imgObj) {
                                                        return tileDB.sliceTileSheet(imgObj, args.name, args.tileWidth, args.tileHeight, args.outputPath || config.outputPath, args.skipAudit, args.skipValidation);
                                                    });
                                            });
                                        }, Promise.resolve());
                                    }, throwOut);
                                });
                        }, throwOut)
                },
                builder: {
                    'skipValidation': {
                        alias: 'v',
                        default: false,
                        type: 'boolean'
                    },
                    'skipAudit': {
                        alias: 'a',
                        default: false,
                        type: 'boolean'
                    }
                }
            })
            .command({
                command: 'list <tileSheetName>',
                description: 'Lists existing tiles in the db',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.list(args.tileSheetName);
                        }, throwOut)

                }
            })
            .command({
                command: 'write [tileSheetName]',
                description: 'Writes tiles in db to files',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.write(args.outputPath || config.outputPath, args.tileSheetName);
                        }, throwOut)

                },
                builder: {
                    outputPath: {
                        alias: 'o'
                    }
                }
            })
            .command({
                command: 'remove <tileSheetName> [tileIndex]',
                description: 'Removes tiles from DB by index or comma-separated indices.',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.removeTile(args.tileSheetName, args.tileIndex ? args.tileIndex.toString().split(",") : null, config.outputPath);
                        }, throwOut)

                }
            })
            .command({
                command: 'config',
                description: 'Sets persistent config options.',
                handler: function(args){
                    var promise = Promise.resolve();
                    if (args.DBPath) {
                        promise = promise
                            .then(function(){
                                var oldPath = path.format({dir: config.DBPath, base: config.DBFileName});
                                var newPath = path.format({dir: args.DBPath, base: config.DBFileName});
                                console.log("Moving DB from", oldPath, "to", newPath);
                                return fs.rename(oldPath, newPath)
                                    .then(function(){
                                        config.DBPath = args.DBPath;
                                        return writeConfig(config)
                                            .then(function(){
                                                console.log("Set DB path to", config.DBPath);
                                            });
                                    }, function(err) {
                                        if (err.code === 'ENOENT') {
                                            config.DBPath = args.DBPath;
                                            return writeConfig(config)
                                                .then(function(){
                                                    console.log("Set DB path to", config.DBPath);
                                                });
                                        } else {
                                            throw 'Failed renaming DB';
                                        }
                                    });
                            });
                    }

                    if (args.outputPath) {
                        promise = promise
                            .then(function(){
                                config.outputPath = args.outputPath;
                                return writeConfig(config)
                                    .then(function(){
                                        console.log("Set default output path to", config.outputPath);
                                    });
                            });
                    }
                },
                builder: {
                    'DBPath': {
                        alias: 'd'
                    },
                    'outputPath': {
                        alias: 'o'
                    }
                }
            })
            .demandCommand(1)
            .argv;


    })
