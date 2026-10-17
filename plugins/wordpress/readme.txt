=== Diazoma Wall ===
Requires at least: 6.0
Requires PHP: 8.1
Stable tag: 0.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Publishes posts and WooCommerce products as a Diazoma wall feed with a .well-known/wall.json manifest and an optional /xr page.

== Description ==

Adds the REST feed diazoma/v1/feed, the wall manifest and discovery link tags. The embedded wall core is Apache-2.0; this plugin is GPL-2.0-or-later.

== Customizing the wall ==

The manifest passes through the `diazoma_wall_manifest` filter just before it is served. Add a `view` to change the action buttons, the info panel, the rows, the colours and the texts of the wall. The filter gets the manifest array and the plugin settings, and must return an array.

`add_filter( 'diazoma_wall_manifest', function ( $manifest ) { $manifest['view'] = array( 'wall' => array( 'rows' => 4 ) ); return $manifest; } );`

== Video ==

A post whose first block is a Video block becomes a video card: the video file or stream (mp4, webm, HLS .m3u8, DASH .mpd) goes in the feed as `video`, with `video_type`, `media_type` and, for a video from the media library, `duration`. The card picture is the featured image, or the block's poster when it is an image in the media library. A file video without a picture stays a plain text card.

A post whose first block is an Embed block with a YouTube or Vimeo link becomes an embed card: `media_type` is `video` and `unplayable` carries the provider and the canonical embed URL (YouTube through youtube-nocookie.com). A YouTube post without a featured image gets YouTube's thumbnail. The host of a link is matched exactly, so a lookalike such as youtube.com.evil.example is ignored.

== Changelog ==

= 0.2.0 =
* Video blocks and YouTube/Vimeo embeds in the feed: `video`, `video_type`, `media_type`, `duration`, `unplayable`.

= 0.1.0 =
* First release.
* Renamed from Stena Wall (working name) before release; no behaviour change.
