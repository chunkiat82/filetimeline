require('colors');
const PATH_DELIMITER = '/'; //path.delimiter;
const FIXED_MESSAGE = 'Raymond Ho @ 2016';
const jsdiff = require('diff');
const debug = require('debug')('timedfile');

import {
    writeFilePromise, readFilePromise, appendFilePromise, readFileSync
} from './fileOperations';

import path from 'path';
const {
  basename,
  dirname
} = path;
import git from 'git-node';

export default class TimedFile {
  constructor(options) {

    const {
      fileFullPath,
      author,
      versionsPath
    } = options;

    this.fileFullPath = fileFullPath;
    this.directory = dirname(this.fileFullPath);
    this.filename = basename(this.fileFullPath);
    this.repoPath = versionsPath || this.directory;
    this.headCommitFile = [this.repoPath, `${this.filename}.commit`].join(PATH_DELIMITER);
    this.repo = git.repo(this.repoPath);
    this.rolls = [];
    this.tree = {};
    try {
      this.commitHash = readFileSync(this.headCommitFile).toString();
    } catch (e) {
      this.commitHash = null;
    }
    debug('constructor - this.commitHash = %s', this.commitHash);

  }

  _saveBlob = (commit) => {
    const that = this;

    const {
      filename,
      repo,
      tree
    } = that;

    const {
      contents,
      author
    } = commit;

    const message = FIXED_MESSAGE;

    const gitCommit = {
      author,
      committer: author,
      filename,
      contents,
      message
    };

    return new Promise((resolve, reject) => {
      repo.saveAs("blob", contents, function (err, contentsHash) {
        if (err) return reject(err);
        tree[filename] = {
          mode: 644,
          hash: contentsHash
        };
        resolve(contentsHash);
      });
    });
  }

  _saveAsCommit = async(commit) => {

    const that = this;

    const {
      filename,
      tree,
      repo,
      repoPath,
      commitHash
    } = that;

    const {
      contents,
      author
    } = commit;

    const message = FIXED_MESSAGE;

    debug('_saveAsCommit - commitHash = %s', commitHash);

    const gitCommit = {
      author,
      parent: commitHash,
      committer: author,
      filename,
      contents,
      message
    };

    return new Promise((resolve, reject) => {
      //get a new parent

      repo.saveAs('tree', tree, function (err, treeHash) {
        if (err) return reject(err);
        debug('treeHash = %s', treeHash);
        const treeCommit = Object.assign({}, gitCommit, {
          tree: treeHash
        });
        if (commitHash === null) delete treeCommit.parent;

        repo.saveAs("commit", treeCommit, async(err, commitHash) => {
          if (err) return reject(err);
          await that._saveCommitHead(commitHash);
          resolve(commitHash);
        });
      });
    });
  }

  /* this loads the tree of files, not really needed for single file repo */
  _loadTree = (commitTreeHash) => {
    const that = this;
    const {
      repo
    } = that;

    return new Promise((resolve, reject) => {
      // debug(`repo=${repo}`);
      repo.loadAs('tree', commitTreeHash, (err, tree) => {

        if (err) return reject(err);
        resolve(tree);
      });
    });
  }

  _loadCommit = (commitHash) => {
    const that = this;
    const {
      repo
    } = that;
    return new Promise((resolve, reject) => {
      repo.loadAs('commit', commitHash, (err, commit) => {
        if (err) return reject(err);
        return resolve(commit);
      });
    });
  }

  _load = (blobHash) => {
    const that = this;
    const {
      repo
    } = that;
    return new Promise((resolve, reject) => {
      repo.loadAs('text', blobHash, (err, text) => {
        if (err) return reject(err);
        return resolve(text);
      });
    });
  }

  _saveCommitHead = async(commitHash) => {
    const that = this;
    const {
      headCommitFile
    } = that;
    return await writeFilePromise(headCommitFile, commitHash);
  };

  save = async(author) => {
    var that = this;

    const {
      fileFullPath
    } = that;

    try {
      const readFile = await readFilePromise(fileFullPath);
      const contents = readFile.toString();
      const commit = {
        author,
        contents
      };

      const contentsHash = await that._saveBlob(commit);
      debug('save - contentsHash = %s', contentsHash);
      that.commitHash = await that._saveAsCommit(commit);
      debug('save - that.commitHash = %s', that.commitHash);

    } catch (e) {
      debug('save - error %s', e);
      throw new Error(e);
    }

  }

  diff = async() => {
    const that = this;
    const {
      fileFullPath,
      commitHash,
    } = that;

    const readFile = await readFilePromise(fileFullPath);
    const currentText = readFile.toString();

    if (commitHash) {
      const headCommitDiff = await that._loadCommit(commitHash);
      debug('diff - headCommitDiffTree = %s', headCommitDiff.tree);
      const loadTreeDiff = await that._loadTree(headCommitDiff.tree);
      debug('diff - loadTreeDiff[0].hash = %s', loadTreeDiff && loadTreeDiff[0].hash);
      const loadText = await that._load(loadTreeDiff[0].hash);
      debug('diff - loadText = %s', loadText);
      return jsdiff.diffChars(loadText, currentText)
    } else {
      return jsdiff.diffChars('', currentText)
    }
  }

  fastforward = async() => {
    const that = this;
    const {
      fileFullPath,
      rolls
    } = that;

    const commit = rolls.pop();

    if (commit) {
      debug('fastforward - commit.tree - %s', commit.tree);
      const loadTreeDiff = await that._loadTree(commit.tree);
      debug('rollback - loadTreeDiff[0].hash = %s', loadTreeDiff && loadTreeDiff[0].hash);
      const loadText = await that._load(loadTreeDiff[0].hash);
      await writeFilePromise(fileFullPath, loadText);
    } else {
      debug('Not existing commit found for fastforward');
    }

  }

  /* we have to check if file is saved , not done yet */
  rollback = async() => {

    //check if file here TBD

    const that = this;
    const {
      fileFullPath,
      commitHash
    } = that;

    if (commitHash) {
      let commit = await that._loadCommit(commitHash);

      if (commit.parents.length === 1) {
        const parentCommitHash = commit.parents[0];
        that.commitHash = parentCommitHash;
        this.rolls.push(commit);
        commit = await that._loadCommit(parentCommitHash);
      } else {
        debug('rollback - headCommitDiff does not any parent that is single, it has [%s] parents', commit.parents.length);
      }

      const loadTreeDiff = await that._loadTree(commit.tree);
      debug('rollback - loadTreeDiff[0].hash = %s', loadTreeDiff && loadTreeDiff[0].hash);
      const loadText = await that._load(loadTreeDiff[0].hash);
      await writeFilePromise(fileFullPath, loadText);
    } else {
      debug('Not existing commit found for rollback');
    }

  }

  reset = async() => {
    const that = this;

    try {
      const commitHashBufffer = await readFilePromise(that.headCommitFile);
      that.commitHash = commitHashBufffer.toString();
    } catch (e) {
      that.commitHash = null;
    }

    const {
      commitHash,
      fileFullPath
    } = that;

    if (commitHash) {
      const commit = await that._loadCommit(commitHash);
      const loadTreeDiff = await that._loadTree(commit.tree);
      const loadText = await that._load(loadTreeDiff[0].hash);
      await writeFilePromise(fileFullPath, loadText);
    } else {
      debug('Not existing commit found for reset');
    }
  }

}


