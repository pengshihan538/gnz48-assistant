param([switch]$ValidateOnly, [string]$BaseDir = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
public class AuctionWorker : IDisposable {
    public readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    private Process process;
    public void Start(string node, string folder) {
        var info = new ProcessStartInfo(node, "http-monitor.js");
        info.WorkingDirectory = folder; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
        process = new Process { StartInfo = info };
        process.OutputDataReceived += (s,e) => { if (e.Data != null) Lines.Enqueue(e.Data); };
        process.ErrorDataReceived += (s,e) => { if (!String.IsNullOrWhiteSpace(e.Data)) Lines.Enqueue("{\"type\":\"error\",\"message\":\"后台运行异常，请重新打开程序。\"}"); };
        process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
    }
    public bool Exited { get { return process != null && process.HasExited; } }
    public void Send(string line) { if(process != null && !process.HasExited) {process.StandardInput.WriteLine(line);process.StandardInput.Flush();} }
    public void Dispose() {
        if (process == null) return;
        try { if(!process.HasExited) {Send("{\"command\":\"stop\"}");if(!process.WaitForExit(500))process.Kill();} } catch {}
        process.Dispose(); process=null;
    }
}
'@
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
 Title="GNZ48 竞价监控 · 桌面版" Width="1360" Height="930" MinWidth="1050" MinHeight="720" WindowStartupLocation="CenterScreen" Background="#F3F5FA" FontFamily="Microsoft YaHei UI" Foreground="#18243B">
 <Window.Resources>
  <Style TargetType="Button"><Setter Property="Padding" Value="18,9"/><Setter Property="Margin" Value="8,0,0,0"/><Setter Property="Background" Value="White"/><Setter Property="BorderBrush" Value="#D9E0EF"/><Setter Property="Cursor" Value="Hand"/><Setter Property="FontSize" Value="13"/></Style>
  <Style TargetType="TabItem"><Setter Property="Padding" Value="22,12"/><Setter Property="FontSize" Value="14"/></Style>
  <Style TargetType="DataGrid"><Setter Property="AutoGenerateColumns" Value="False"/><Setter Property="IsReadOnly" Value="True"/><Setter Property="CanUserAddRows" Value="False"/><Setter Property="HeadersVisibility" Value="Column"/><Setter Property="GridLinesVisibility" Value="Horizontal"/><Setter Property="HorizontalGridLinesBrush" Value="#ECF0F6"/><Setter Property="RowHeight" Value="34"/><Setter Property="BorderThickness" Value="0"/><Setter Property="FontSize" Value="13"/><Setter Property="AlternatingRowBackground" Value="#F6F8FC"/></Style>
 </Window.Resources>
 <Grid Margin="26,20,26,16">
  <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
  <Grid Margin="0,0,0,18"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
   <StackPanel><TextBlock Text="理想座位竞价监控" FontSize="26" FontWeight="Bold"/><TextBlock x:Name="ItemTitle" Text="纯 HTTP 采集 · 原生桌面界面 · 只读" FontSize="13" Foreground="#64748B" Margin="0,7,0,0"/></StackPanel>
    <StackPanel Grid.Column="1" HorizontalAlignment="Right"><TextBlock x:Name="ClockText" FontFamily="Consolas" FontSize="20"/><TextBlock x:Name="ClockSource" Text="北京时间 UTC+8 · 本机时钟，打开场次后官网校时" FontSize="11" Foreground="#64748B" HorizontalAlignment="Right" Margin="0,6,0,0"/></StackPanel>
  </Grid>
  <UniformGrid Grid.Row="1" Columns="4" Margin="-6,0,-6,15">
   <Border Background="White" CornerRadius="12" Padding="20,15" Margin="6,0"><StackPanel><TextBlock Text="我的最高出价" Foreground="#64748B"/><TextBlock x:Name="MyPrice" Text="—" FontSize="28" FontWeight="SemiBold" Margin="0,5"/><TextBlock x:Name="MySeat" Text="等待完整数据" FontSize="12" Foreground="#64748B"/></StackPanel></Border>
   <Border Background="White" CornerRadius="12" Padding="20,15" Margin="6,0"><StackPanel><TextBlock Text="我的当前排名" Foreground="#64748B"/><TextBlock x:Name="MyRank" Text="—" FontSize="28" FontWeight="SemiBold" Margin="0,5"/><TextBlock Text="每人仅保留最高价；排名为估算" FontSize="12" Foreground="#64748B"/></StackPanel></Border>
   <Border Background="White" CornerRadius="12" Padding="20,15" Margin="6,0"><StackPanel><TextBlock Text="去重竞拍人数" Foreground="#64748B"/><TextBlock x:Name="People" Text="—" FontSize="28" FontWeight="SemiBold" Margin="0,5"/><TextBlock x:Name="PageInfo" Text="正在读取全部分页" FontSize="12" Foreground="#64748B"/></StackPanel></Border>
   <Border Background="White" CornerRadius="12" Padding="20,15" Margin="6,0"><StackPanel><TextBlock Text="当前最高价格" Foreground="#64748B"/><TextBlock x:Name="HighPrice" Text="—" FontSize="28" FontWeight="SemiBold" Margin="0,5"/><TextBlock Text="价格分布不设上限" FontSize="12" Foreground="#64748B"/></StackPanel></Border>
  </UniformGrid>
  <Border Grid.Row="2" Background="#E9EEFE" CornerRadius="10" Padding="17,13" Margin="0,0,0,16"><TextBlock x:Name="Advice" Text="正在连接网站，完整采集成功后才生成排名和建议……" FontSize="14" FontWeight="SemiBold" TextWrapping="Wrap"/></Border>
  <TabControl x:Name="Tabs" Grid.Row="3" BorderThickness="0" Background="Transparent">
   <TabItem Header="竞价列表"><Grid Margin="10,16"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
    <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
     <StackPanel Orientation="Horizontal"><TextBox x:Name="CatalogSearch" Width="250" Height="34" Padding="8" VerticalContentAlignment="Center" ToolTip="搜索公演名称、日期或竞价编号"/><ComboBox x:Name="CatalogFilter" Width="135" Height="34" Margin="10,0" SelectedIndex="0"><ComboBoxItem Content="全部类型"/><ComboBoxItem Content="普通座"/><ComboBoxItem Content="VIP/尊享"/><ComboBoxItem Content="站票"/><ComboBoxItem Content="其他"/></ComboBox><ComboBox x:Name="CatalogState" Width="110" Height="34" SelectedIndex="0"><ComboBoxItem Content="全部状态"/><ComboBoxItem Content="进行中"/><ComboBoxItem Content="未开始"/><ComboBoxItem Content="已结束"/></ComboBox></StackPanel>
     <StackPanel Grid.Column="1" Orientation="Horizontal"><Button x:Name="CatalogReload" Content="刷新竞价列表"/><Button x:Name="CatalogOpen" Content="打开所选竞价" Background="#3659DE" Foreground="White"/></StackPanel>
    </Grid>
    <TextBlock x:Name="CatalogStatus" Grid.Row="1" Text="自动抓取官网全部竞价目录……可搜索名称或编号，双击一行打开。" Foreground="#64748B" Margin="0,12" TextWrapping="Wrap"/>
    <DataGrid x:Name="CatalogTable" Grid.Row="2" SelectionMode="Single" EnableRowVirtualization="True"><DataGrid.Columns><DataGridTextColumn Header="编号" Binding="{Binding id}" Width="70"/><DataGridTextColumn Header="竞价 / 公演" Binding="{Binding title}" Width="*"/><DataGridTextColumn Header="类型" Binding="{Binding category}" Width="85"/><DataGridTextColumn Header="状态" Binding="{Binding status}" Width="85"/><DataGridTextColumn Header="最高价" Binding="{Binding price}" Width="80"/><DataGridTextColumn Header="单位" Binding="{Binding currency}" Width="55"/><DataGridTextColumn Header="官网人数" Binding="{Binding count}" Width="85"/></DataGrid.Columns></DataGrid>
   </Grid></TabItem>
   <TabItem Header="理想座位"><UniformGrid x:Name="BandCards" Columns="2" Rows="3" Margin="0,8,0,0"/></TabItem>
   <TabItem Header="价格分布"><Grid Margin="10,12,10,0">
    <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="2.6*"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
    <TextBlock Text="具体价格分布 · 全部有效价格" FontSize="18" FontWeight="SemiBold"/>
    <TextBlock x:Name="PriceChartCaption" Grid.Row="1" Text="全部价格单排显示 · 按价格升序 · 柱宽与间距自动适配窗口" Foreground="#64748B" Margin="0,5,0,8" FontSize="12"/>
    <Canvas x:Name="ExactChart" Grid.Row="2"/>
    <TextBlock Grid.Row="3" Text="价格区间分布" FontSize="16" FontWeight="SemiBold" Margin="0,10,0,6"/>
    <Canvas x:Name="RangeChart" Grid.Row="4"/>
   </Grid></TabItem>
   <TabItem Header="排名明细"><Grid Margin="12"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
    <TextBlock Text="完整分页 → 每人最高价 → 价格降序、同价按时间先后；最终座位以官网为准。" Foreground="#64748B" Margin="0,0,0,12" TextWrapping="Wrap"/>
    <DataGrid x:Name="RankTable" Grid.Row="1"><DataGrid.Columns><DataGridTextColumn Header="排名" Binding="{Binding rank}" Width="70"/><DataGridTextColumn Header="标记" Binding="{Binding mine}" Width="60"/><DataGridTextColumn Header="竞拍者" Binding="{Binding bidder}" Width="*"/><DataGridTextColumn Header="最高价" Binding="{Binding price}" Width="100"/><DataGridTextColumn Header="出价时间（北京）" Binding="{Binding time}" Width="200"/><DataGridTextColumn Header="目标排" Binding="{Binding location}" Width="80"/></DataGrid.Columns></DataGrid>
   </Grid></TabItem>
  </TabControl>
  <Grid Grid.Row="4" Margin="0,16,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
   <StackPanel VerticalAlignment="Center"><TextBlock x:Name="Status" Text="启动中……" FontSize="13" TextWrapping="Wrap"/><TextBlock x:Name="Freshness" Text="不会自动出价；网络错误时保留旧数据并标记过期。" FontSize="11" Foreground="#64748B" Margin="0,5,0,0"/></StackPanel>
   <StackPanel Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Center"><Button x:Name="Pause" Content="暂停自动刷新"/><Button x:Name="Refresh" Content="手动刷新" Background="#3659DE" Foreground="White" BorderThickness="0"/></StackPanel>
  </Grid>
 </Grid>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}
'ClockText','ClockSource','ItemTitle','MyPrice','MyRank','MySeat','People','PageInfo','HighPrice','Advice','BandCards','ExactChart','RangeChart','PriceChartCaption','RankTable','Status','Freshness','Pause','Refresh','Tabs' | ForEach-Object { $ui[$_] = $window.FindName($_) }
'CatalogTable','CatalogStatus','CatalogSearch','CatalogFilter','CatalogState','CatalogReload','CatalogOpen' | ForEach-Object {$ui[$_]=$window.FindName($_)}
$script:catalogItems=@()
$script:selectedId=$null
$script:state = @{ Snapshot=$null; Busy=$false; Paused=$false; LastError=$null; Next=$null; ClockMs=0.0; ClockWatch=$null; Closed=$false }
$script:chartSpecs = New-Object System.Collections.ArrayList
$script:adviceLabels = New-Object System.Collections.ArrayList
function Text($value, $size=12, $color='#18243B') {
    $t=New-Object Windows.Controls.TextBlock
    $t.Text=[string]$value; $t.FontSize=$size; $t.Foreground=$color
    return $t
}
function Money($value) {
    if($null -eq $value){return '—'}
    if($script:state.Snapshot.currency -eq '积分'){return $value.ToString()+'积分'}
    return '¥'+$value
}
function Filter-Catalog {
    $query=$ui.CatalogSearch.Text.Trim()
    $kind=$ui.CatalogFilter.SelectedItem.Content
    $status=$ui.CatalogState.SelectedItem.Content
    $items=@($script:catalogItems | Where-Object {
        (-not $query -or $_.title.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.id.ToString().Contains($query)) -and
        ($kind -eq '全部类型' -or $_.category -eq $kind) -and ($status -eq '全部状态' -or $_.status -eq $status)
    })
    $ui.CatalogTable.ItemsSource=$items
    $ui.CatalogStatus.Text='官网共 '+$script:catalogItems.Count+' 场 · 当前显示 '+$items.Count+' 场 · 搜索名称 / 编号，双击一行打开；切换场次后只监控当前这一场。'
}
function Open-SelectedAuction {
    $item=$ui.CatalogTable.SelectedItem
    if($null -ne $item){$worker.Send((@{command='select';itemId=$item.id}|ConvertTo-Json -Compress))}
}
function Get-BarLayout([double]$width, [int]$count) {
    $available=[math]::Max([double]0,$width-24)
    if($count -le 0){return [pscustomobject]@{Slot=0;Offset=12;BarWidth=0}}
    $slot=$available/$count
    $slot=[math]::Min([double]60,$slot)
    return [pscustomobject]@{Slot=$slot;Offset=($width-$slot*$count)/2;BarWidth=[math]::Min([double]30,$slot*0.62)}
}
function Draw-Chart($canvas, $items, [double]$height) {
    $canvas.Children.Clear();$entries=@($items);$n=$entries.Count
    $width=[math]::Max([double]300,$canvas.ActualWidth)
    if($n -eq 0){$t=Text '此排名区间暂无记录' 12 '#8090A6';[Windows.Controls.Canvas]::SetTop($t,30);[void]$canvas.Children.Add($t);return}
    $max=[math]::Max(1,($entries | Measure-Object count -Maximum).Maximum)
    $layout=Get-BarLayout $width $n
    $slot=$layout.Slot; $offset=$layout.Offset; $base=$height-30; $plot=$height-54
    for($i=0;$i -lt $n;$i++) {
        $item=$entries[$i];$barHeight=if($item.count -gt 0){[math]::Max(2,$plot*$item.count/$max)}else{0}
        $bar=New-Object Windows.Shapes.Rectangle
        $bar.Width=$layout.BarWidth;$bar.Height=$barHeight;$bar.RadiusX=3;$bar.RadiusY=3;$bar.Fill='#4866DD'
        $label=if($null -ne $item.price){Money $item.price}else{[string]$item.label}
        $bar.ToolTip=$label+' · '+$item.count+'人'
        [Windows.Controls.Canvas]::SetLeft($bar,$offset+$i*$slot+($slot-$bar.Width)/2);[Windows.Controls.Canvas]::SetTop($bar,$base-$barHeight);[void]$canvas.Children.Add($bar)
        $count=Text ($item.count.ToString()+'人') 10 '#64748B';$count.Width=$slot;$count.TextAlignment='Center'
        [Windows.Controls.Canvas]::SetLeft($count,$offset+$i*$slot);[Windows.Controls.Canvas]::SetTop($count,[math]::Max(0,$base-$barHeight-18));[void]$canvas.Children.Add($count)
        $price=Text $label 10 '#64748B';$price.Width=$slot;$price.TextAlignment='Center'
        [Windows.Controls.Canvas]::SetLeft($price,$offset+$i*$slot);[Windows.Controls.Canvas]::SetTop($price,$base+6);[void]$canvas.Children.Add($price)
    }
}
function Get-PriceChartLayout([double]$width, [double]$height, [int]$count, [double]$labelWidth=40) {
    $available=[math]::Max([double]1,$width-24)
    # Never wrap: share the available width between every price in one row.
    $columns=[math]::Max(1,$count)
    $slot=[math]::Min([double]60,$available/$columns)
    $fontSize=[math]::Min([double]11,$height/6)
    $fontSize=[math]::Min($fontSize,11*$slot*0.9/[math]::Max([double]1,$labelWidth))
    return [pscustomobject]@{Columns=$columns;Rows=1;Slot=$slot;Offset=($width-$slot*$columns)/2;FontSize=$fontSize;BarWidth=[math]::Min([double]30,$slot*0.62);PlotHeight=[math]::Max([double]0,$height-$fontSize*4)}
}
function Draw-FittedChart($canvas, $items, [bool]$exact=$false) {
    $canvas.Children.Clear();$entries=@($items);$n=$entries.Count
    $width=$canvas.ActualWidth;$height=$canvas.ActualHeight
    # Hidden tabs are measured when opened; SizeChanged redraws using the real bounds.
    if($width -le 0 -or $height -le 0){return}
    if($n -eq 0){$fontSize=[math]::Min([double]12,$height/2);$t=Text '此区间暂无出价记录' $fontSize '#8090A6';[Windows.Controls.Canvas]::SetTop($t,[math]::Max([double]0,($height-$fontSize*1.5)/2));[void]$canvas.Children.Add($t);return}
    $labels=@($entries | ForEach-Object {if($null -ne $_.price){Money $_.price}else{[string]$_.label}})
    $labelWidth=[double]0
    $measureLabels=@($labels)+@($entries | ForEach-Object {$_.count.ToString()+'人'})
    foreach($label in $measureLabels){$measure=Text $label 11;$measure.Measure([Windows.Size]::new([double]::PositiveInfinity,[double]::PositiveInfinity));$labelWidth=[math]::Max($labelWidth,$measure.DesiredSize.Width)}
    $layout=Get-PriceChartLayout $width $height $n $labelWidth
    $max=[math]::Max([double]1,($entries | Measure-Object count -Maximum).Maximum)
    if($exact){$ui.PriceChartCaption.Text='全部 '+$n+' 个价位 · 按价格升序单排显示 · 柱宽与间距自动适配窗口'}
    for($i=0;$i -lt $n;$i++){
        $item=$entries[$i]
        $left=$layout.Offset+$i*$layout.Slot
        $base=$height-$layout.FontSize*2
        $barHeight=$layout.PlotHeight*[math]::Max([double]0,[double]$item.count)/$max
        $tooltip=$labels[$i]+' · '+$item.count+'人'
        $bar=New-Object Windows.Shapes.Rectangle;$bar.Width=$layout.BarWidth;$bar.Height=$barHeight;$bar.RadiusX=3;$bar.RadiusY=3;$bar.Fill='#4866DD';$bar.ToolTip=$tooltip
        [Windows.Controls.Canvas]::SetLeft($bar,$left+($layout.Slot-$bar.Width)/2);[Windows.Controls.Canvas]::SetTop($bar,$base-$barHeight);[void]$canvas.Children.Add($bar)
        $count=Text ($item.count.ToString()+'人') $layout.FontSize '#64748B';$count.Width=$layout.Slot;$count.TextAlignment='Center';$count.ToolTip=$tooltip
        [Windows.Controls.Canvas]::SetLeft($count,$left);[Windows.Controls.Canvas]::SetTop($count,$base-$barHeight-$layout.FontSize*1.7);[void]$canvas.Children.Add($count)
        $price=Text $labels[$i] $layout.FontSize '#64748B';$price.Width=$layout.Slot;$price.TextAlignment='Center';$price.ToolTip=$tooltip
        [Windows.Controls.Canvas]::SetLeft($price,$left);[Windows.Controls.Canvas]::SetTop($price,$base+$layout.FontSize*0.25);[void]$canvas.Children.Add($price)
    }
}
function Fit-BandCards {
    if($ui.BandCards.ActualHeight -le 0){return}
    $cellHeight=$ui.BandCards.ActualHeight/3
    foreach($spec in $script:chartSpecs){
        # Shrink whitespace and text together before giving the remaining height to the chart.
        $preferredHeight=if($spec.Ended){178.0}else{198.0}
        $scale=[math]::Min([double]1,$cellHeight/$preferredHeight)
        $spec.Box.Margin=[Windows.Thickness]::new(5*$scale)
        $spec.Box.Padding=[Windows.Thickness]::new(16*$scale,10*$scale,16*$scale,10*$scale)
        $spec.Title.FontSize=15*$scale
        $spec.Caption.FontSize=11*$scale;$spec.Caption.Margin=[Windows.Thickness]::new(0,3*$scale,0,4*$scale)
        $spec.Advice.FontSize=12*$scale;$spec.Advice.Margin=[Windows.Thickness]::new(0,3*$scale,0,0)
        if($null -ne $spec.Interval){$spec.Interval.FontSize=10*$scale;$spec.Interval.Margin=[Windows.Thickness]::new(0,2*$scale,0,0)}
    }
}
function Render-Charts {
    if($null -eq $script:state.Snapshot){return}
    Fit-BandCards
    foreach($spec in $script:chartSpecs){Draw-FittedChart $spec.Canvas $spec.Items}
    Draw-FittedChart $ui.ExactChart $script:state.Snapshot.exactDistribution $true
    Draw-FittedChart $ui.RangeChart $script:state.Snapshot.rangeDistribution
}
function Render-Snapshot($data) {
    $script:state.Snapshot=$data;$script:state.LastError=$null
    $ui.ItemTitle.Text=$data.title+' · HTTP 只读采集'
    $ui.MyPrice.Text=Money $data.current.price
    $ui.MyRank.Text=if($null -eq $data.current.rank){'—'}else{'第 '+$data.current.rank+' 名'}
    $ui.MySeat.Text=if($data.current.band){$data.current.band}elseif($null -ne $data.current.price){'当前不在目标中间区域'}else{'未找到当前账号的出价记录'}
    $ui.People.Text=$data.bidderCount.ToString()+' 人'
    $ui.HighPrice.Text=Money $data.highestPrice
    $ui.PageInfo.Text='{0}/{1} 页 · 原始 {2} 条' -f $data.scanMeta.pagesRead,$data.scanMeta.totalPages,$data.scanMeta.rawRows
    $ui.Advice.Text=$data.advice;$ui.Advice.Foreground='#18243B'
    $ui.Status.Foreground='#237A5A'
    $ui.Status.Text='完整采集成功 · {0:N2} 秒 · {1}' -f ($data.durationMs/1000),$(if($data.ended){'竞价已结束，自动刷新已停止'}else{'每 30 秒自动采集'})
    $ui.Pause.IsEnabled=-not $data.ended
    $ui.RankTable.ItemsSource=@($data.ranking)
    if($null -ne $data.clock){$script:state.ClockMs=[double]$data.clock.serverNowMs;$script:state.ClockWatch=[Diagnostics.Stopwatch]::StartNew();$ui.ClockSource.Text='北京时间 UTC+8 · 官网校时，往返估算 ±'+$data.clock.uncertaintyMs+' ms（非标准授时）'}
    else {$script:state.ClockWatch=$null;$ui.ClockSource.Text='北京时间 UTC+8 · 本机时钟，官网校时失败'}
    $ui.BandCards.Children.Clear();$script:chartSpecs.Clear();$script:adviceLabels.Clear()
    foreach($band in $data.targetBands){
        $box=New-Object Windows.Controls.Border;$box.Background='White';$box.CornerRadius=10;$box.Padding='16,10';$box.Margin='5,5'
        $panel=New-Object Windows.Controls.Grid;$box.Child=$panel
        foreach($rowSize in @('Auto','Auto','*','Auto','Auto')){$row=New-Object Windows.Controls.RowDefinition;$row.Height=[Windows.GridLengthConverter]::new().ConvertFromString($rowSize);[void]$panel.RowDefinitions.Add($row)}
        $title=Text ($band.label+'  ·  排名 '+$band.min+'–'+$band.max) 15;$title.FontWeight='SemiBold';[void]$panel.Children.Add($title)
        $caption=Text ('偏好 '+$band.priority+' · 仅计每人最高价') 11 '#8090A6';$caption.Margin='0,3,0,4';[Windows.Controls.Grid]::SetRow($caption,1);[void]$panel.Children.Add($caption)
        $canvas=New-Object Windows.Controls.Canvas;[Windows.Controls.Grid]::SetRow($canvas,2);[void]$panel.Children.Add($canvas)
        $canvas.Tag=@{Items=$band.observed}
        $canvas.Add_SizeChanged({param($sender,$eventArgs) Draw-FittedChart $sender $sender.Tag.Items})
        $r=$band.recommendation
        $advice=if($data.ended){'已结束 · 仅展示最终价格分布'}elseif($null -eq $r){'当前暂无可达价格'}elseif($r.hold){'已在区间 · 建议保持 ¥'+$r.price}else{'参考建议 ¥'+$r.price+' · 预计第 '+$r.rank+' 名 · 缓冲 '+$r.buffer+' 名'}
        $a=Text $advice 12 '#237A5A';$a.TextWrapping='Wrap';$a.Margin='0,3,0,0';[Windows.Controls.Grid]::SetRow($a,3);[void]$panel.Children.Add($a)
        [void]$script:adviceLabels.Add($a)
        $it=$null
        if(-not $data.ended){
            $ranges=@($band.intervals | ForEach-Object {if($null -eq $_.max){'¥'+$_.min+' 起'}elseif($_.min -eq $_.max){'¥'+$_.min}else{'¥'+$_.min+'–'+$_.max}})
            $it=Text ('可行价：'+$(if($ranges.Count){$ranges -join ' / '}else{'暂无'})) 10 '#8090A6';$it.TextWrapping='Wrap';$it.Margin='0,2,0,0';[Windows.Controls.Grid]::SetRow($it,4);[void]$panel.Children.Add($it)
        }
        [void]$script:chartSpecs.Add(@{Box=$box;Panel=$panel;Title=$title;Caption=$caption;Advice=$a;Interval=$it;Ended=$data.ended;Canvas=$canvas;Items=$band.observed})
        [void]$ui.BandCards.Children.Add($box)
    }
    $window.UpdateLayout();Render-Charts
    if($data.seatEligible -eq $false){$ui.Tabs.Items[1].IsEnabled=$false;$ui.Tabs.SelectedIndex=2}
}
if($ValidateOnly){
    $fixture=[pscustomobject]@{
        title='SELF TEST';current=[pscustomobject]@{price=118;rank=37;band='9排中间'};bidderCount=80;highestPrice=204
        scanMeta=[pscustomobject]@{pagesRead=5;totalPages=5;rawRows=90};advice='TEST';durationMs=1200;ended=$false;clock=$null
        ranking=@([pscustomobject]@{rank=1;bidder='TEST';price=204;time='2026-09-24 10:00:00';mine='';location=7})
        exactDistribution=@([pscustomobject]@{price=118;count=5});rangeDistribution=@([pscustomobject]@{label='111-120';count=5})
        targetBands=@([pscustomobject]@{label='9排中间';min=33;max=42;priority=1;observed=@([pscustomobject]@{price=118;count=5});intervals=@([pscustomobject]@{min=118;max=$null});recommendation=[pscustomobject]@{price=118;rank=37;hold=$false;buffer=5}})
    }
    $ui.Tabs.SelectedIndex=2
    $window.Content.Measure([Windows.Size]::new(1360,930));$window.Content.Arrange([Windows.Rect]::new(0,0,1360,930));$window.Content.UpdateLayout()
    Render-Snapshot $fixture
    if($ui.BandCards.Children.Count -ne 1 -or $ui.ExactChart.Children.Count -ne 3 -or $ui.People.Text -ne '80 人'){throw ('Native rendering validation failed: cards={0}, chart={1}, width={2}, height={3}' -f $ui.BandCards.Children.Count,$ui.ExactChart.Children.Count,$ui.ExactChart.ActualWidth,$ui.ExactChart.ActualHeight)}
    foreach($case in @(@{Width=1000;Count=1},@{Width=1000;Count=2},@{Width=1000;Count=10},@{Width=300;Count=10})){
        $layout=Get-BarLayout $case.Width $case.Count
        if($layout.Slot -gt 60 -or $layout.Offset -lt 12 -or $layout.BarWidth -gt 30 -or [math]::Abs(2*$layout.Offset+$layout.Slot*$case.Count-$case.Width) -gt 0.01){throw 'Compact histogram layout validation failed'}
    }
    if((Get-BarLayout 1000 2).Slot -ne 60 -or (Get-BarLayout 1000 0).BarWidth -ne 0){throw 'Histogram sparse/empty validation failed'}
    if($xaml.SelectNodes("//*[@Header='价格分布']//*[local-name()='ScrollViewer']").Count -ne 0){throw 'Price distribution must not contain scrolling containers'}
    foreach($size in @(@{Width=1034;Height=680},@{Width=1344;Height=890},@{Width=1900;Height=1000})){
        $window.Content.Measure([Windows.Size]::new($size.Width,$size.Height));$window.Content.Arrange([Windows.Rect]::new(0,0,$size.Width,$size.Height));$window.Content.UpdateLayout()
        foreach($n in @(0,1,2,19,20,21,38,40,41,50,100,200)){
            $items=@(for($i=0;$i -lt $n;$i++){[pscustomobject]@{price=(98+$i);count=($i%20)+1}})
            Draw-FittedChart $ui.ExactChart $items $true
            if($ui.ExactChart.Children.Count -ne $(if($n){3*$n}else{1})){throw 'Adaptive chart omitted an entry'}
            for($i=0;$i -lt $n;$i++){
                if($ui.ExactChart.Children[$i*3+2].Text -ne (Money $items[$i].price)){throw 'Adaptive price order changed'}
                if($i -gt 0 -and [math]::Abs([Windows.Controls.Canvas]::GetTop($ui.ExactChart.Children[$i*3+2])-[Windows.Controls.Canvas]::GetTop($ui.ExactChart.Children[2])) -gt 0.01){throw 'All price labels must stay in one row'}
                foreach($child in @($ui.ExactChart.Children[$i*3],$ui.ExactChart.Children[$i*3+1],$ui.ExactChart.Children[$i*3+2])){
                    $child.Measure([Windows.Size]::new([double]::PositiveInfinity,[double]::PositiveInfinity))
                    $left=[Windows.Controls.Canvas]::GetLeft($child);$top=[Windows.Controls.Canvas]::GetTop($child)
                    if($left -lt 0 -or $top -lt 0 -or $left+$child.DesiredSize.Width -gt $ui.ExactChart.ActualWidth+0.1 -or $top+$child.DesiredSize.Height -gt $ui.ExactChart.ActualHeight+0.1){throw ('Adaptive chart overflow: {0} prices at {1}x{2}' -f $n,$size.Width,$size.Height)}
                }
                if($i -ge 20 -and [math]::Abs($ui.ExactChart.Children[$i*3].Height-$ui.ExactChart.Children[($i-20)*3].Height) -gt 0.01){throw 'Bars must share the same count scale'}
            }
        }
        Draw-FittedChart $ui.RangeChart @('≤98','99–110','111–120','121–130','131–140','141–150','151–175','176–200','>200' | ForEach-Object {[pscustomobject]@{label=$_;count=5}})
        if($ui.RangeChart.Children.Count -ne 27 -or $ui.RangeChart.ActualHeight -le 0){throw 'Range distribution must remain visible'}
    }
    if((Get-PriceChartLayout 974 165 38).BarWidth -ge (Get-PriceChartLayout 974 165 20).BarWidth){throw 'More prices must produce narrower bars'}
    if($xaml.SelectNodes("//*[@Header='理想座位']//*[local-name()='ScrollViewer']").Count -ne 0){throw 'Ideal seats must not contain scrolling containers'}
    $fixture.targetBands=@(for($i=0;$i -lt 6;$i++){
        [pscustomobject]@{label=(@('9','10','8','11','7','12')[$i]+'排中间');min=(1+$i*20);max=(10+$i*20);priority=($i+1)
            observed=@(if($i -lt 5){for($j=0;$j -lt 10;$j++){[pscustomobject]@{price=(100+$j);count=($j%3+1)}}})
            intervals=@([pscustomobject]@{min=118;max=126});recommendation=[pscustomobject]@{price=118;rank=37;hold=$false;buffer=5}}
    })
    $ui.Tabs.SelectedIndex=1
    foreach($ended in @($false,$true)){
        $fixture.ended=$ended
        Render-Snapshot $fixture
        foreach($size in @(@{Width=1034;Height=680},@{Width=1344;Height=790},@{Width=1344;Height=890},@{Width=1900;Height=1000})){
            $window.Content.Measure([Windows.Size]::new($size.Width,$size.Height));$window.Content.Arrange([Windows.Rect]::new(0,0,$size.Width,$size.Height));$window.Content.UpdateLayout()
            Render-Charts;$window.Content.UpdateLayout();Render-Charts;$window.Content.UpdateLayout()
            if($ui.BandCards.Children.Count -ne 6 -or $ui.BandCards.Rows -ne 3 -or $ui.BandCards.Columns -ne 2){throw 'All six ideal seat cards must be present'}
            foreach($spec in $script:chartSpecs){
                $cardOrigin=$spec.Box.TranslatePoint([Windows.Point]::new(0,0),$ui.BandCards)
                if($cardOrigin.X -lt 0 -or $cardOrigin.Y -lt 0 -or $cardOrigin.X+$spec.Box.ActualWidth -gt $ui.BandCards.ActualWidth+0.1 -or $cardOrigin.Y+$spec.Box.ActualHeight -gt $ui.BandCards.ActualHeight+0.1){throw 'A seat card extends beyond the visible page'}
                if($spec.Canvas.ActualHeight -le 0 -or $spec.Canvas.Children.Count -ne $(if(@($spec.Items).Count){3*@($spec.Items).Count}else{1})){throw 'Seat chart must retain all prices and positive space'}
                foreach($child in $spec.Panel.Children){
                    $origin=$child.TranslatePoint([Windows.Point]::new(0,0),$spec.Box)
                    if($origin.X -lt 0 -or $origin.Y -lt 0 -or $origin.X+$child.ActualWidth -gt $spec.Box.ActualWidth+0.1 -or $origin.Y+$child.ActualHeight -gt $spec.Box.ActualHeight+0.1){throw ('Seat card content overflow at {0}x{1}, ended={2}' -f $size.Width,$size.Height,$ended)}
                }
                foreach($child in $spec.Canvas.Children){
                    $left=[Windows.Controls.Canvas]::GetLeft($child);if([double]::IsNaN($left)){$left=0}
                    $top=[Windows.Controls.Canvas]::GetTop($child)
                    if($top -lt 0 -or $left+$child.RenderSize.Width -gt $spec.Canvas.ActualWidth+0.1 -or $top+$child.RenderSize.Height -gt $spec.Canvas.ActualHeight+0.1){throw 'Seat chart label or bar overflow'}
                }
            }
        }
    }
    Write-Output 'WPF validated: single-row price distributions; all six seat cards fit without scrollbars at 4 window sizes, active and ended auctions; titles, advice, empty states, bars and labels remain inside their cards.';return
}
$created=$false
$mutex=New-Object Threading.Mutex($true,'Local\GNZ48AuctionNative33444',([ref]$created))
if(-not $created){[void][Windows.MessageBox]::Show('桌面监控已经运行，请使用现有窗口。','GNZ48');$mutex.Dispose();return}
$worker=New-Object AuctionWorker
$ui.Advice.Text='先在竞价列表选择场次，再查看实时排名与价格分布。'
$ui.ItemTitle.Text='官网全部竞价目录 · 可搜索、筛选、切换场次'
$ui.Refresh.IsEnabled=$false;$ui.Pause.IsEnabled=$false
1..3 | ForEach-Object {$ui.Tabs.Items[$_].IsEnabled=$false}
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromMilliseconds(40)
$timer.Add_Tick({
    try {
        $line=$null;$processed=0
        while($processed -lt 60 -and $worker.Lines.TryDequeue([ref]$line)) {
            $processed++;$message=$line | ConvertFrom-Json
            switch($message.type){
                'catalogStatus' {$ui.CatalogStatus.Text=$message.message;$ui.CatalogStatus.Foreground=if($message.failed){'#B83C46'}else{'#64748B'}}
                'catalogBusy' {$ui.CatalogReload.IsEnabled=-not $message.value;$ui.CatalogReload.Content=if($message.value){'抓取列表中…'}else{'刷新竞价列表'}}
                'catalog' {$script:catalogItems=@($message.data.items);Filter-Catalog;$ui.CatalogStatus.Foreground='#64748B';if(-not $script:selectedId){$ui.Status.Text='竞价列表已加载 · 双击场次或点击“打开所选竞价”'}}
                'selected' {
                    $script:selectedId=$message.item.id;$script:state.Snapshot=$null;$script:state.Paused=$false;$script:state.LastError=$null;$script:state.Next=$null
                    $ui.MyPrice.Text='—';$ui.MyRank.Text='—';$ui.People.Text='—';$ui.HighPrice.Text='—';$ui.MySeat.Text='正在读取当前场次';$ui.PageInfo.Text='等待完整分页'
                    $ui.ItemTitle.Text=$message.item.title+' · HTTP 只读采集';$ui.Advice.Text='正在读取新场次，不沿用上一场排名……';$ui.Advice.Foreground='#18243B'
                    $ui.BandCards.Children.Clear();$ui.ExactChart.Children.Clear();$ui.RangeChart.Children.Clear();$script:chartSpecs.Clear();$script:adviceLabels.Clear();$ui.RankTable.ItemsSource=$null
                    1..3 | ForEach-Object {$ui.Tabs.Items[$_].IsEnabled=$true}
                    $ui.Tabs.SelectedIndex=if($message.item.category -eq '普通座' -and $message.item.currency -eq '元'){1}else{2}
                    $ui.Pause.Content='暂停自动刷新'
                }
                'status' {$ui.Status.Text=$message.message;$ui.Status.Foreground='#64748B'}
                'busy' {$script:state.Busy=[bool]$message.value;$ui.Refresh.IsEnabled=-not $script:state.Busy;$ui.Refresh.Content=if($script:state.Busy){'正在刷新…'}else{'手动刷新'}}
                'snapshot' {if($message.data.itemId -eq $script:selectedId){Render-Snapshot $message.data}}
                'schedule' {$script:state.Next=$message.nextAtMs}
                'paused' {$script:state.Paused=[bool]$message.value;$ui.Pause.Content=if($script:state.Paused){'恢复自动刷新'}else{'暂停自动刷新'}}
                'error' {$script:state.LastError=$message.message;$ui.Status.Text=$message.message;$ui.Status.Foreground='#B83C46';$ui.Advice.Text='数据未更新 · '+$message.message;$ui.Advice.Foreground='#B83C46';foreach($label in $script:adviceLabels){$label.Text='旧数据 · 已暂停建议，请刷新';$label.Foreground='#B83C46'};if($message.paused){$script:state.Paused=$true;$ui.Pause.Content='恢复自动刷新'}}
            }
        }
        if($script:state.ClockWatch){$ms=$script:state.ClockMs+$script:state.ClockWatch.Elapsed.TotalMilliseconds;$now=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).ToOffset([TimeSpan]::FromHours(8))}
        else {$now=[DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8))}
        $ui.ClockText.Text=$now.ToString('yyyy/MM/dd HH:mm:ss.fff')
        if($script:state.Snapshot){
            $age=[math]::Max(0,[math]::Floor(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$script:state.Snapshot.updatedAtMs)/1000))
            $next=if($script:state.Snapshot.ended){'已结束，仅手动刷新'}elseif($script:state.Paused){'自动采集已暂停'}elseif($script:state.Next){'下次采集约 '+[math]::Max(0,[math]::Ceiling(($script:state.Next-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())/1000))+' 秒后'}else{'采集中'}
            $ui.Freshness.Text='数据距今 '+$age+' 秒 · '+$next+' · 推荐不保证最终座位'
            if(-not $script:state.Snapshot.ended -and $age -gt 65 -and -not $script:state.LastError){$ui.Advice.Text='数据已过期，请刷新后再参考建议。';$ui.Advice.Foreground='#B83C46';foreach($label in $script:adviceLabels){$label.Text='数据已过期 · 暂停建议';$label.Foreground='#B83C46'}}
        }
        if($worker.Exited -and -not $script:state.Closed){$ui.Status.Text='后台已停止，请关闭窗口后重新打开。';$ui.Status.Foreground='#B83C46';$ui.Refresh.IsEnabled=$false;$ui.Pause.IsEnabled=$false}
    } catch {
        $ui.Status.Text='界面更新异常，请重新打开窗口。';$ui.Status.Foreground='#B83C46'
        [IO.File]::WriteAllText((Join-Path $BaseDir 'desktop-error.log'),$_.Exception.ToString(),[Text.Encoding]::UTF8)
    }
})
$ui.Refresh.Add_Click({$worker.Send('{"command":"refresh"}')})
$ui.CatalogReload.Add_Click({$worker.Send('{"command":"catalog"}')})
$ui.CatalogOpen.Add_Click({Open-SelectedAuction})
$ui.CatalogTable.Add_MouseDoubleClick({Open-SelectedAuction})
$ui.CatalogSearch.Add_TextChanged({Filter-Catalog})
$ui.CatalogFilter.Add_SelectionChanged({Filter-Catalog})
$ui.CatalogState.Add_SelectionChanged({Filter-Catalog})
$ui.Pause.Add_Click({$value=-not $script:state.Paused;$worker.Send((@{command='pause';value=$value}|ConvertTo-Json -Compress))})
$window.Add_SizeChanged({try{Render-Charts}catch{}})
$ui.BandCards.Add_SizeChanged({try{Render-Charts}catch{}})
$ui.ExactChart.Add_SizeChanged({try{Render-Charts}catch{}})
$ui.RangeChart.Add_SizeChanged({try{Render-Charts}catch{}})
$ui.Tabs.Add_SelectionChanged({try{Render-Charts}catch{}})
$window.Add_Closed({$script:state.Closed=$true;$timer.Stop();$worker.Dispose();$mutex.ReleaseMutex();$mutex.Dispose()})
$window.Add_ContentRendered({
    try {
        $node=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if(-not (Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
        $worker.Start($node,$BaseDir);$timer.Start()
    } catch {$ui.Status.Text='无法启动后台，请确认 Node 和依赖已安装。';$ui.Status.Foreground='#B83C46'}
})
[void]$window.ShowDialog()
