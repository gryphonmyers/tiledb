#!/usr/bin/env node

var _ = require("lodash");
var yargs = require('yargs');
var TileDB = require('./tile-db');
var Jimp = require('jimp');
var throwOut = require('./helpers/throw-out');
var fs = require('mz/fs');
var path = require('path');

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
                command: 'slice <src> <name> <tileWidth> <tileHeight> [outputPath]',
                description: 'Add a tileset image to the db',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return fs.lstat(args.src)
                                .then(function(stats){
                                    if (stats.isDirectory()) {
                                        return fs.readdir(args.src)
                                            .then(function(filePaths){
                                                return Promise.all(
                                                    _.map(filePaths, function(filePath){
                                                        return Jimp.read(path.format({dir: args.src, base: filePath}));
                                                    })
                                                )
                                                .then(function(imgs){
                                                    return tileDB.sliceTileSheet(imgs, args.name, args.tileWidth, args.tileHeight, args.outputPath || config.outputPath);
                                                })
                                            })
                                    } else if (stats.isFile()) {
                                        return Jimp.read(args.src)
                                            .then(function(imgObj) {
                                                return tileDB.sliceTileSheet(imgObj, args.name, args.tileWidth, args.tileHeight, args.outputPath || config.outputPath);
                                            }, function(){
                                                console.log('Skipping non-image.');
                                            });
                                    }
                                }, throwOut)
                        }, throwOut)
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
                command: 'write [outputPath] [tileSheetName]',
                description: 'Writes tiles in db to files',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.write(args.outputPath || config.outputPath, args.tileSheetName);
                        }, throwOut)

                }
            })
            .command({
                command: 'remove [tileHash]',
                description: 'Removes tiles from DB by hash or comma-separated hashes.',
                handler: function(args){
                    tileDB.init()
                        .then(function(){
                            return tileDB.removeTile(args.tileHash.split(","));
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
