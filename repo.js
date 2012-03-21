module.exports = function (deps) {
  var a = deps.diff
  var hash = deps.hash

  // reimplementing git, because I'm insane.

  function Repository () {
    this.commits = {}
    this.branches = {}
    this.tags = {}
    this.get = this.get.bind(this)
    this.getId = this.getId.bind(this)
  }

  function map(obj, itr) {
    var r = {}
    for (var i in obj)
      r[i] = itr(obj[i], i, obj)
    return r
  }

  function copy(obj) {
    return map(obj, function(e) {return e})
  }

  function keys (obj) {
    var ks = []
    for (var k in obj)
      ks.push(k)
    return ks
  }

  Repository.prototype = {
    commit: function (world, meta) {
      //meta is author, message, parent commit
      //this is the current state of the repo.
      //commit will diff it with the head of the given branch 
      //and then save that diff in the commit list.

      // head = checkout (branch)
      // diff(head, world)
      // bundle with meta, add to commits 
      var branch = meta.parent //save the branch name
      meta.parent = this.getId(branch) 
      var commit = copy(meta) // filter correct attributs only?
      commit.changes = this.diff(meta.parent, world)
      if(!commit.changes)
        throw new Error('there are no changes') 
      commit.depth = (this.commits[meta.parent] || {depth: 0}).depth + 1
      commit.timestamp = Date.now()
      commit.id = hash(commit)

      // XXX make an error if the commits are empty !!! XXX 

      this.commits[commit.id] = commit
      this.branch(branch, commit.id)
      return commit
        // emit the new commit 
    },
    get: function (commitish) {
      return this.commits[commitish] || this.commits[this.branches[commitish] || this.tags[commitish]]
    },
    getId: function (commitish) {
      return (this.get(commitish) || {id:null}).id 
    },
    tag: function (name, commitish) {
      if(this.commits[name] || this.branches[name]) return
      this.tags[name] = this.getId(commitish) 
    },
    branch: function (name, commitish) {
      // do not save this as a branch if it's actually a commit, or a tag.
      if(this.commits[name] || this.tags[name]) return
      return this.branches[name] = this.getId(commitish)
    },
    diff: function (parent, world) {
      var head = this.checkout(parent)
      if('object' !== typeof world)
        world = this.checkout(world)
      return a.diff(head, world)
    },
    revlist: function (id, since) {
      id = this.getId(id) // force to commit
      var revlist = []
      var exclude = since ? this.revlist(since) : []
      var self = this
      function recurse (id) {
        if( ~revlist.indexOf(id) || !id) return
        if(~exclude.indexOf(id)) return
        var commit = self.get(id)
        if(!commit.merged) //one parent
          recurse(commit.parent)
        else
          commit.merged.forEach(recurse)
        revlist.push(id)
      }
      recurse(id)
      return revlist
    },
    getRevs: function (head) {
      return this.revlist(head).map(this.get)
    },
    clone: function (remote, branch) {
      for(var j in this.commits)
        throw new Error('can only clone on an empty repo')
      if(!branch)
        throw new Error('expect branch to clone')
      this.addCommits(remote.getRevs(branch), branch)
      //save the remote head.
    },
    push: function (remote, branch) {
      var revlist = this.revlist(branch)
      var ff = remote.isFastForward(remote.getId(branch), revlist)
      if(!ff)
        throw new Error('cannot push because is not a fast-forward. pull first')
      remote.addCommits(ff.map(this.get), branch) //will send just the ff commits.
      //save the remote head.
      return ff
    },
    pull: function (remote, branch, since) {
      var revs = remote.getRevs(branch, since)
      var revlist = revs.map(function (e) { return e.id })
      //if remote has sent a ff, don't need to merge.
      var ff
      if(ff = this.isFastForward(branch, revlist)) {
        this.addCommits(revs, branch)
      } else {
        var rHead = revs[revs.length -1]
        this.addCommits(revs)
        this.merge([branch, rHead])
      }
    },
    isFastForward: function (head, revlist) {
      //return the nodes of revlist that fast-forward head.
      // revlist two is a ff if head is an ancestor.
      if(!~revlist.indexOf(this.getId(head))) return false
      //remove the matchng head of the revlist 
      var _revlist = this.revlist(head)
      revlist = revlist.slice()
      //got a feeling that this isn't right.
      while(_revlist[0] == revlist[0])
        _revlist.shift(), revlist.shift()
      return revlist

    },
    concestor: function (heads) { //a list of commits you want to merge
      if(arguments.length > 1)
        heads = [].slice.call(arguments)
      // find the concestor of the heads
      // this is the only interesting problem left!
      // get the revlist of the first head
      // recurse down from each head, looking for the last index of that item.
      // chop the tail when you find something, and move to the next head.
      // the concestor(a, b, c) must equal concestor(concestor(a, b), c)
      var getId = this.getId.bind(this)
      heads = heads.map(getId)
      var first = heads.shift()
      var revlist = this.revlist(first)
      var commits = this.commits
      var l =  -1
      function find (h) {
        var i = revlist.lastIndexOf(h, ~l ? l : null)
        if(i !== -1) l = i
        else find(commits[h].parent)
      }
      while(heads.length)
        find(heads.shift())
      return revlist[l]
    },
   addCommits: function (commits, branch) {
      //iterate through commits
      var self = this
      commits.forEach(function (e) {
        if('object' !== typeof e) throw new Error(e + ' is not a commit')
        if(self.commits[e.id]) return
        if(self.commits[e.parent] || e.parent == null)
          self.commits[e.id] = e
        else
          throw new Error('dangling commit:' + e.id + ' ' + JSON.stringify(e)) // should never happen.
      })
      if(branch) this.branch(branch, commits[commits.length - 1].id)
    },
    merge: function (branches, meta) { //branches...
      var self = this
      var mine = branches[0]
      branches = branches.map(this.getId)
      var concestor = this.concestor(branches)
      branches.splice(1, 0, concestor)
      var commit = meta ? copy(meta) : {}
      var checkouts = branches.map(function (e) {
        return self.checkout(e)
      })
      commit.changes = a.diff3(checkouts)
      if(!commit.changes)
        throw new Error('there are no changes') 
      commit.merged = branches.slice()
      commit.merged.splice(1,1) //concestor should not be in merged
      commit.parent = this.getId(branches[0])
      commit.depth = this.get(branches[0]).depth + 1
      commit.timestamp = Date.now()

      commit.id = hash(commit)

      this.commits[commit.id] = commit
      this.branch(mine, commit.id) // if this was merge( ['master', ...], ...) update the branch
      return commit
    },
    checkout: function (commitish) {
      //idea: cache recently hit checkouts
      //will improve performance of large merges
      if(commitish == null)
        return {}
      var commit = this.get(commitish)
      var state = this.checkout(commit.parent)
      return a.patch(state, commit.changes)
    }
  }

  return Repository
}
