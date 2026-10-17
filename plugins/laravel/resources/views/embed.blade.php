<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $name }}</title>
    <link rel="wall-manifest" href="{{ $manifest }}">
    <style>html,body{margin:0;height:100%;background:#0e0e10}</style>
</head>
<body>
    <script src="{{ $scriptUrl }}" data-manifest="{{ $manifest }}" data-route="{{ $route }}" data-core="{{ $coreUrl }}"@if (! empty($locale)) data-locale="{{ $locale }}"@endif></script>
</body>
</html>
